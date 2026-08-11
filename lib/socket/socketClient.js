import socketService from '../../services/socket';

const sendDomainEvent = (service, socket, event, data) => {
  if (socket) {
    return service.sendOn(socket, event, data);
  }

  return service.send(event, data);
};

const ensureConnectedSocket = (socket) => {
  if (!socket?.connected) {
    throw new Error('Socket not connected');
  }
};

const createTimeoutError = (message) => new Error(message);

// [ADDED] lib/socket/socketClient.js — markMessagesAsRead emit 횟수 계측기.
// ReadStatus.js의 "메시지별 독립 observer가 각자 즉시 emit"하던 구조를
// "room 단위로 모아서 debounce 후 1번만 emit"으로 바꾸는 작업의 전/후 효과를
// 눈으로 비교하기 위한 용도. 방(roomId)별로 실제 emit이 몇 번 나갔는지 세어
// 브라우저 콘솔에 로그를 남긴다. 실제 통신 동작에는 영향 없음(카운트 + 로그만 함).
//
// 사용법: 방에 입장한 뒤 콘솔에서 "[read-receipt]"로 필터링하면, 이번 방 진입 후
// emit이 몇 번 발생했는지 순서대로 볼 수 있다.
// - 최적화 전(onVisible 미연결, 즉 ReadStatus가 직접 emit): 화면에 동시에 보인
//   메시지 개수만큼 카운트가 한꺼번에 올라간다.
// - 최적화 후(onVisible 연결, useReadReceiptDebounce 경유): 같은 상황에서도
//   카운트가 1만 올라간다.
const readReceiptEmitCounts = new Map();

const logReadReceiptEmit = (roomId, lastReadMessageId) => {
  const nextCount = (readReceiptEmitCounts.get(roomId) || 0) + 1;
  readReceiptEmitCounts.set(roomId, nextCount);
  console.info(
    `[read-receipt] markMessagesAsRead emit #${nextCount} (room=${roomId}, messageId=${lastReadMessageId})`
  );
};

// 방에 새로 입장할 때 카운터를 리셋해서, 이번 방문에서 emit이 몇 번 나갔는지
// 0부터 다시 셀 수 있게 한다.
export const resetReadReceiptEmitCount = (roomId) => {
  readReceiptEmitCounts.delete(roomId);
};

const waitForSocketEvent = ({
  socket,
  successEvent,
  errorEvents,
  timeoutMs,
  timeoutMessage,
  send,
}) => {
  ensureConnectedSocket(socket);

  return new Promise((resolve, reject) => {
    let timeoutId;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      socket.off(successEvent, handleSuccess);
      for (const event of errorEvents) {
        socket.off(event, handleError);
      }
    };

    const settle = (callback, value) => {
      cleanup();
      callback(value);
    };

    const handleSuccess = (data) => settle(resolve, data);
    const handleError = (error) => settle(reject, error);

    socket.once(successEvent, handleSuccess);
    for (const event of errorEvents) {
      socket.once(event, handleError);
    }

    timeoutId = setTimeout(() => {
      settle(reject, createTimeoutError(timeoutMessage));
    }, timeoutMs);

    try {
      send();
    } catch (error) {
      settle(reject, error);
    }
  });
};

const roomEventMap = {
  participantsUpdate: 'onParticipantsUpdate',
  messagesRead: 'onMessagesRead',
  message: 'onMessage',
  previousMessagesLoaded: 'onPreviousMessagesLoaded',
  messageReactionUpdate: 'onMessageReactionUpdate',
  session_ended: 'onSessionEnded',
  error: 'onError',
};

const connectionEventMap = {
  connect: 'onConnect',
  disconnect: 'onDisconnect',
  connect_error: 'onConnectError',
};

/**
 * socket.io v4 에서 재연결 이벤트는 socket 이 아니라 manager(socket.io)에서 발생한다.
 * socket 에 붙이면 영원히 호출되지 않아 재연결 성공도 최종 실패도 감지하지 못한다.
 */
const managerEventMap = {
  reconnect_attempt: 'onReconnecting',
  reconnect: 'onReconnect',
  reconnect_failed: 'onReconnectFailed',
};

const subscribeMappedEvents = (emitter, handlers, eventMap) => {
  if (!emitter) {
    return () => {};
  }

  const subscriptions = Object.entries(eventMap)
    .map(([event, handlerName]) => [event, handlers[handlerName]])
    .filter(([, handler]) => typeof handler === 'function');

  for (const [event, handler] of subscriptions) {
    emitter.on(event, handler);
  }

  return () => {
    for (const [event, handler] of subscriptions) {
      emitter.off(event, handler);
    }
    handlers.onDispose?.();
  };
};

export const createSocketClient = (service = socketService) => ({
  connect: (options) => service.connect(options),
  disconnect: () => service.disconnect(),
  isConnected: () => service.isConnected(),
  canSend: () => service.isConnected(),
  send: (event, data) => service.send(event, data),
  sendChatMessage: (payload, socket) => sendDomainEvent(service, socket, 'chatMessage', payload),
  sendChatMessageAndWait: (payload, socket, { timeoutMs = 8000 } = {}) =>
    waitForSocketEvent({
      socket,
      successEvent: 'message',
      errorEvents: ['error'],
      timeoutMs,
      timeoutMessage: '메시지 전송이 지연되고 있습니다. 다시 시도해주세요.',
      send: () => sendDomainEvent(service, socket, 'chatMessage', payload),
    }),
  fetchPreviousMessages: (payload, socket) => sendDomainEvent(service, socket, 'fetchPreviousMessages', payload),
  fetchPreviousMessagesAndWait: (payload, socket, { timeoutMs = 10000 } = {}) =>
    waitForSocketEvent({
      socket,
      successEvent: 'previousMessagesLoaded',
      errorEvents: ['error'],
      timeoutMs,
      timeoutMessage: '메시지 로딩 시간이 초과되었습니다.',
      send: () => sendDomainEvent(service, socket, 'fetchPreviousMessages', payload),
    }),
  joinRoom: (roomId, socket) => sendDomainEvent(service, socket, 'joinRoom', roomId),
  joinRoomAndWait: (roomId, socket, { timeoutMs = 10000 } = {}) =>
    waitForSocketEvent({
      socket,
      successEvent: 'joinRoomSuccess',
      errorEvents: ['joinRoomError', 'error'],
      timeoutMs,
      timeoutMessage: '채팅방 입장 시간이 초과되었습니다.',
      // [ADDED] 방 재입장 시 emit 계측 카운터를 0부터 다시 세도록 리셋.
      send: () => {
        resetReadReceiptEmitCount(roomId);
        return sendDomainEvent(service, socket, 'joinRoom', roomId);
      },
    }),
  leaveRoom: (roomId, socket) => sendDomainEvent(service, socket, 'leaveRoom', roomId),
  tryLeaveRoom: (roomId, socket) => service.trySendOn(socket, 'leaveRoom', roomId),
  // [CHANGED] lib/socket/socketClient.js: markMessagesAsRead(messageIds, socket)
  // -> markMessagesAsRead(roomId, lastReadMessageId, socket).
  // Last Read Watermark 방식: 서버는 이제 "읽은 메시지 ID 목록"이 아니라
  // "여기까지 읽었다"는 워터마크 좌표(roomId + 마지막 메시지 1건)만 필요로 한다.
  markMessagesAsRead: (roomId, lastReadMessageId, socket) => {
    if (!roomId || !lastReadMessageId) {
      throw new Error('roomId and lastReadMessageId are required');
    }

    // [ADDED] 베이스라인/최적화 후 emit 횟수 비교용 로그. 실제 전송 전에 카운트.
    logReadReceiptEmit(roomId, lastReadMessageId);

    return sendDomainEvent(service, socket, 'markMessagesAsRead', { roomId, lastReadMessageId });
  },
  sendMessageReaction: (messageId, reaction, type, socket) => sendDomainEvent(service, socket, 'messageReaction', {
    messageId,
    reaction,
    type,
  }),
  subscribeRoomEvents: (socket, handlers) => subscribeMappedEvents(socket, handlers, roomEventMap),
  subscribeConnectionEvents: (socket, handlers) => {
    const unsubscribeSocket = subscribeMappedEvents(socket, handlers, connectionEventMap);
    const unsubscribeManager = subscribeMappedEvents(socket?.io, handlers, managerEventMap);

    return () => {
      unsubscribeSocket();
      unsubscribeManager();
    };
  },
});

const socketClient = createSocketClient();

export default socketClient;
