import { deriveUniqueSortedMessages } from '../messages/useMessageList';

export const processLoadedRoomMessages = ({
  loadedMessages,
  hasMore,
  isInitialLoad = false,
  processedMessageIds,
  setMessages,
  setHasMoreMessages,
  initialLoadCompletedRef,
}) => {
  if (!Array.isArray(loadedMessages)) {
    throw new Error('Invalid messages format');
  }

  const processedSnapshot = new Set(processedMessageIds.current);
  processedMessageIds.current = deriveUniqueSortedMessages(
    [],
    loadedMessages,
    processedSnapshot
  ).processedMessageIds;

  let nextMessages;
  setMessages(prev => {
    nextMessages = deriveUniqueSortedMessages(prev, loadedMessages, processedSnapshot).messages;
    return nextMessages;
  });
  setHasMoreMessages(hasMore);

  if (isInitialLoad) {
    initialLoadCompletedRef.current = true;
  }

  return nextMessages;
};

// [CHANGED] features/chat/room/roomEventHandlers.js: applyReadReceipts가 메시지 배열을
// 순회하며 각 메시지의 readers 배열을 갱신하던 방식(Last Read Watermark 전환 전)에서,
// room 단위의 읽음 워터마크 맵 하나만 갱신하는 방식으로 바뀌었다.
// 서버가 보내는 payload도 { userId, messageIds, timestamp } -> { userId, lastReadAt }로
// 가벼워졌다 (참고: apps/backend .../MessagesReadResponse.java).
export const applyReadWatermark = (room, { userId, lastReadAt }) => ({
  ...room,
  readReceipts: {
    ...(room?.readReceipts || {}),
    [userId]: lastReadAt,
  },
});

// 방 입장(joinRoomSuccess) 시 받은 참가자별 초기 워터마크 스냅샷을
// { [userId]: lastReadAt } 맵으로 변환한다.
export const toReadReceiptsMap = (participantReadStates = []) =>
  participantReadStates.reduce((acc, state) => {
    if (state?.userId && state?.lastReadAt) {
      acc[state.userId] = state.lastReadAt;
    }
    return acc;
  }, {});

export const appendIncomingMessage = (messages, incoming) => {
  if (!incoming?._id) {
    return messages;
  }

  if (messages.some(msg => msg._id === incoming._id)) {
    return messages;
  }

  return [...messages, incoming];
};

export const createRoomEventHandlers = ({
  mountedRef,
  messageProcessingRef,
  processedMessageIds,
  initialLoadCompletedRef,
  processMessages,
  setRoom,
  setMessages,
  setLoadingMessages,
  setError,
  setHasMoreMessages,
  cleanup,
  logout,
  onReplace,
  handleReactionUpdate,
  showRejectedMessage,
}) => {
  const handlePreviousMessages = (response) => {
    if (!mountedRef.current || messageProcessingRef.current) return;
    try {
      messageProcessingRef.current = true;
      if (!response || typeof response !== 'object') {
        throw new Error('Invalid response format');
      }
      const { messages: loadedMessages = [], hasMore } = response;
      const isInitialLoad = !initialLoadCompletedRef.current;
      processMessages(loadedMessages, hasMore, isInitialLoad);
      setLoadingMessages(false);
    } catch (error) {
      setLoadingMessages(false);
      setError('메시지 처리 중 오류가 발생했습니다.');
      setHasMoreMessages(false);
    } finally {
      messageProcessingRef.current = false;
    }
  };

  return {
    onParticipantsUpdate: (participants) => {
      if (!mountedRef.current) return;
      setRoom(prev => ({ ...prev, participants: participants || [] }));
    },
    // [CHANGED] onMessagesRead: setMessages(메시지별 readers 갱신) -> setRoom(방 단위
    // readReceipts 워터마크 갱신). ReadStatus 컴포넌트가 room.readReceipts와
    // 메시지 timestamp를 비교해 안읽음 인원 수를 계산한다.
    onMessagesRead: (payload) => {
      if (!mountedRef.current) return;
      setRoom(prev => applyReadWatermark(prev, payload));
    },
    onMessage: (incoming) => {
      if (!mountedRef.current || messageProcessingRef.current) return;
      if (!incoming?._id || processedMessageIds.current.has(incoming._id)) return;
      processedMessageIds.current.add(incoming._id);
      setMessages(prev => appendIncomingMessage(prev, incoming));
    },
    onPreviousMessagesLoaded: handlePreviousMessages,
    onMessageReactionUpdate: (data) => {
      if (!mountedRef.current) return;
      handleReactionUpdate(data);
    },
    onSessionEnded: () => {
      if (!mountedRef.current) return;
      cleanup();
      logout();
      onReplace('/?error=session_expired');
    },
    onError: (error) => {
      if (!mountedRef.current) return;
      console.error('Socket error:', error);
      if (error?.code === 'MESSAGE_REJECTED') {
        showRejectedMessage(error.message || '금칙어가 포함되어 메시지를 전송할 수 없습니다.');
        return;
      }
      setError(error.message || '채팅 연결에 문제가 발생했습니다.');
    },
  };
};
