import { useCallback } from 'react';
import { Toast } from '@/components/Toast';
import socketClient from '@/lib/socket/socketClient';
import { useChatFileUpload } from '../files/useChatFileUpload';

/**
 * 메시지 timestamp를 epoch milliseconds로 변환한다.
 */
const toTimestampMillis = (timestamp) => {
  if (timestamp == null) {
    return null;
  }

  /*
   * 서버 MessageResponse의 timestamp는 기본적으로 number지만,
   * 문자열로 전달되는 경우도 안전하게 처리한다.
   */
  const numericTimestamp = Number(timestamp);

  if (Number.isFinite(numericTimestamp) && numericTimestamp > 0) {
    return numericTimestamp;
  }

  const parsedTimestamp = new Date(timestamp).getTime();

  return Number.isFinite(parsedTimestamp) ? parsedTimestamp : null;
};

/**
 * 복합 keyset cursor의 경계가 될 가장 오래된 메시지를 찾는다.
 *
 * 정렬 기준:
 * 1. timestamp ASC
 * 2. timestamp가 같으면 messageId ASC
 */
const findOldestMessage = (messages) => {
  if (!Array.isArray(messages)) {
    return null;
  }

  return messages.reduce((oldest, message) => {
    if (!message?._id) {
      return oldest;
    }

    const messageTimestamp = toTimestampMillis(message.timestamp);

    if (messageTimestamp == null) {
      return oldest;
    }

    if (!oldest) {
      return message;
    }

    const oldestTimestamp = toTimestampMillis(oldest.timestamp);

    if (oldestTimestamp == null) {
      return message;
    }

    if (messageTimestamp < oldestTimestamp) {
      return message;
    }

    /*
     * timestamp가 같으면 MongoDB의 _id 정렬 순서와
     * 동일하게 더 작은 ID를 오래된 경계로 사용한다.
     */
    if (messageTimestamp === oldestTimestamp && message._id < oldest._id) {
      return message;
    }

    return oldest;
  }, null);
};

export const useMessageHandling = (
  currentUser,
  roomId,
  handleSessionError,
  messages = [],
  loadingMessages = false,
  setLoadingMessages,
  socketRef
) => {
  const {
    filePreview,
    uploading,
    uploadProgress,
    uploadError,
    setFilePreview,
    setUploading,
    setUploadError,
    resetFileUpload,
    uploadChatFile,
  } = useChatFileUpload();

  const getRoomSocket = useCallback(
    () => socketRef?.current ?? null,
    [socketRef]
  );

  const canSendOnRoomSocket = useCallback(() => {
    if (socketRef) {
      return Boolean(getRoomSocket()?.connected);
    }

    return socketClient.canSend();
  }, [getRoomSocket, socketRef]);

  /**
   * 이전 메시지 페이지 조회
   *
   * 기존 before timestamp 대신
   * (timestamp, messageId) 복합 cursor를 전송한다.
   */
  const handleLoadMore = useCallback(() => {
    if (!canSendOnRoomSocket()) {
      return;
    }

    if (loadingMessages) {
      return;
    }

    const oldestMessage = findOldestMessage(messages);

    if (!oldestMessage) {
      return;
    }

    const cursorTimestamp = toTimestampMillis(oldestMessage.timestamp);

    if (cursorTimestamp == null || !oldestMessage._id) {
      return;
    }

    setLoadingMessages(true);

    /*
     * 응답 처리는 기존 previousMessagesLoaded
     * 이벤트 핸들러가 담당한다.
     */
    socketClient.fetchPreviousMessages(
      {
        roomId,
        limit: 30,
        cursor: {
          timestamp: cursorTimestamp,
          messageId: oldestMessage._id,
        },
      },
      getRoomSocket()
    );
  }, [
    roomId,
    loadingMessages,
    messages,
    setLoadingMessages,
    canSendOnRoomSocket,
    getRoomSocket,
  ]);

  const handleMessageSubmit = useCallback(
    async (messageData) => {
      const roomSocket = getRoomSocket();

      if (!canSendOnRoomSocket() || !currentUser) {
        Toast.error('채팅 서버와 연결이 끊어졌습니다.');
        return;
      }

      if (!roomId) {
        Toast.error('채팅방 정보를 찾을 수 없습니다.');
        return;
      }

      try {
        if (messageData.type === 'file') {
          const uploadResponse = await uploadChatFile(
            messageData.fileData.file,
            currentUser
          );

          await socketClient.sendChatMessageAndWait(
            {
              room: roomId,
              type: 'file',
              content: messageData.content || '',
              fileData: {
                _id: uploadResponse.data.file._id,
                filename: uploadResponse.data.file.filename,
                originalname: uploadResponse.data.file.originalname,
                mimetype: uploadResponse.data.file.mimetype,
                size: uploadResponse.data.file.size,
              },
            },
            roomSocket
          );

          resetFileUpload();
        } else if (messageData.content?.trim()) {
          await socketClient.sendChatMessageAndWait(
            {
              room: roomId,
              type: 'text',
              content: messageData.content.trim(),
            },
            roomSocket
          );
        }
      } catch (error) {
        if (
          error.message?.includes('세션') ||
          error.message?.includes('인증') ||
          error.message?.includes('토큰')
        ) {
          await handleSessionError();
          return;
        }

        /*
         * 서버가 거부한 메시지는 onError 핸들러가
         * 이미 토스트로 알렸으므로 중복 표시하지 않는다.
         */
        if (error?.code !== 'MESSAGE_REJECTED') {
          Toast.error(error.message || '메시지 전송 중 오류가 발생했습니다.');
        }

        if (messageData.type === 'file') {
          setUploadError(error.message);
          setUploading(false);
        }
      }
    },
    [
      currentUser,
      roomId,
      handleSessionError,
      uploadChatFile,
      resetFileUpload,
      setUploadError,
      setUploading,
      canSendOnRoomSocket,
      getRoomSocket,
    ]
  );

  const removeFilePreview = useCallback(() => {
    resetFileUpload();
  }, [resetFileUpload]);

  return {
    filePreview,
    uploading,
    uploadProgress,
    uploadError,
    setFilePreview,
    handleMessageSubmit,
    handleLoadMore,
    removeFilePreview,
  };
};

export default useMessageHandling;
