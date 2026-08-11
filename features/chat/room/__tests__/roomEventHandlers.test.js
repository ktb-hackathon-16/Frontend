import { describe, expect, it, vi } from 'vitest';
import {
  appendIncomingMessage,
  appendIncomingMessages,
  applyReadWatermark,
  toReadReceiptsMap,
  createRoomEventHandlers,
  processLoadedRoomMessages,
} from '../roomEventHandlers';

describe('roomEventHandlers', () => {
  it('processes loaded messages through the shared message list reducer', () => {
    const processedMessageIds = { current: new Set(['message-1']) };
    const initialLoadCompletedRef = { current: false };
    const setMessages = vi.fn(updater => {
      const currentMessages = [{ _id: 'message-1', timestamp: '2026-07-07T00:00:02.000Z' }];
      return updater(currentMessages);
    });
    const setHasMoreMessages = vi.fn();

    const result = processLoadedRoomMessages({
      loadedMessages: [
        { _id: 'message-1', timestamp: '2026-07-07T00:00:02.000Z' },
        { _id: 'message-2', timestamp: '2026-07-07T00:00:01.000Z' },
      ],
      hasMore: false,
      isInitialLoad: true,
      processedMessageIds,
      setMessages,
      setHasMoreMessages,
      initialLoadCompletedRef,
    });

    expect(result.map(message => message._id)).toEqual(['message-2', 'message-1']);
    expect(processedMessageIds.current.has('message-2')).toBe(true);
    expect(setHasMoreMessages).toHaveBeenCalledWith(false);
    expect(initialLoadCompletedRef.current).toBe(true);
  });

  // [CHANGED] applyReadReceipts(messages, payload) -> applyReadWatermark(room, payload).
  // Last Read Watermark 방식: 메시지별 readers 배열 대신 room.readReceipts에
  // "유저별 마지막으로 읽은 시각" 1개만 갱신한다.
  it('advances the room read watermark for a user', () => {
    const room = { _id: 'room-1', readReceipts: { 'user-1': '2026-07-06T00:00:00.000Z' } };

    expect(
      applyReadWatermark(room, {
        userId: 'user-2',
        roomId: 'room-1',
        lastReadMessageId: 'message-2',
        lastReadAt: '2026-07-07T00:00:00.000Z',
      })
    ).toEqual({
      _id: 'room-1',
      readReceipts: {
        'user-1': '2026-07-06T00:00:00.000Z',
        'user-2': '2026-07-07T00:00:00.000Z',
      },
    });
  });

  it('converts participantReadStates into a readReceipts map', () => {
    expect(
      toReadReceiptsMap([
        { userId: 'user-1', lastReadMessageId: 'message-1', lastReadAt: '2026-07-06T00:00:00.000Z' },
        { userId: 'user-2', lastReadMessageId: null, lastReadAt: null },
      ])
    ).toEqual({ 'user-1': '2026-07-06T00:00:00.000Z' });
  });

  it('appends incoming messages only once', () => {
    const currentMessages = [{ _id: 'message-1' }];

    expect(appendIncomingMessage(currentMessages, { _id: 'message-1' })).toBe(
      currentMessages
    );
    expect(
      appendIncomingMessage(currentMessages, { _id: 'message-2' })
    ).toEqual([{ _id: 'message-1' }, { _id: 'message-2' }]);
    expect(
      appendIncomingMessages(currentMessages, [
        { _id: 'message-1' },
        { _id: 'message-2' },
        { _id: 'message-3' },
      ])
    ).toEqual([{ _id: 'message-1' }, { _id: 'message-2' }, { _id: 'message-3' }]);
  });

  it('keeps live messages when the updater is invoked twice (StrictMode)', () => {
    vi.useFakeTimers();
    const mountedRef = { current: true };
    const processedMessageIds = { current: new Set() };
    let committed = [];
    const setMessages = vi.fn(updater => {
      // React StrictMode invokes state updaters twice with the same base state
      // in development to surface impure updaters. Both calls must agree.
      const first = updater(committed);
      const second = updater(committed);
      expect(second).toEqual(first);
      committed = second;
    });

    const handlers = createRoomEventHandlers({
      mountedRef,
      messageProcessingRef: { current: false },
      processedMessageIds,
      initialLoadCompletedRef: { current: true },
      processMessages: vi.fn(),
      setRoom: vi.fn(),
      setMessages,
      setLoadingMessages: vi.fn(),
      setError: vi.fn(),
      setHasMoreMessages: vi.fn(),
      cleanup: vi.fn(),
      logout: vi.fn(),
      onReplace: vi.fn(),
      handleReactionUpdate: vi.fn(),
      showRejectedMessage: vi.fn(),
    });

    handlers.onMessage({ _id: 'message-live' });
    vi.advanceTimersByTime(50);

    expect(committed.map(message => message._id)).toEqual(['message-live']);
    vi.useRealTimers();
  });

  it('creates room event handlers with mounted and processing guards', () => {
    vi.useFakeTimers();
    const mountedRef = { current: true };
    const messageProcessingRef = { current: false };
    const processedMessageIds = { current: new Set() };
    const initialLoadCompletedRef = { current: false };
    const setRoom = vi.fn();
    const setMessages = vi.fn();
    const setLoadingMessages = vi.fn();
    const setError = vi.fn();
    const setHasMoreMessages = vi.fn();
    const processMessages = vi.fn();
    const cleanup = vi.fn();
    const logout = vi.fn();
    const onReplace = vi.fn();
    const handleReactionUpdate = vi.fn();
    const showRejectedMessage = vi.fn();

    const handlers = createRoomEventHandlers({
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
    });

    handlers.onParticipantsUpdate([{ _id: 'user-1' }]);
    // [CHANGED] onMessagesRead payload: messageIds 배열 -> lastReadMessageId/lastReadAt
    // 워터마크 1개. 이제 setRoom을 호출한다 (메시지별 배열이 아니라 room.readReceipts 갱신).
    handlers.onMessagesRead({
      userId: 'user-1',
      roomId: 'room-1',
      lastReadMessageId: 'message-1',
      lastReadAt: '2026-07-07T00:00:00.000Z',
    });
    handlers.onMessage({ _id: 'message-1' });
    vi.advanceTimersByTime(50);
    handlers.onPreviousMessagesLoaded({ messages: [{ _id: 'message-2' }], hasMore: true });
    handlers.onMessageReactionUpdate({ messageId: 'message-1' });
    handlers.onSessionEnded();
    handlers.onError({ code: 'MESSAGE_REJECTED', message: 'blocked' });

    // setRoom: onParticipantsUpdate 1회 + onMessagesRead(워터마크 갱신) 1회 = 2회
    expect(setRoom).toHaveBeenCalledTimes(2);
    expect(setRoom).toHaveBeenCalledWith(expect.any(Function));
    // setMessages: onMessage 1회만 (onMessagesRead는 더 이상 setMessages를 호출하지 않음)
    expect(setMessages).toHaveBeenCalledTimes(1);
    expect(processMessages).toHaveBeenCalledWith([{ _id: 'message-2' }], true, true);
    expect(setLoadingMessages).toHaveBeenCalledWith(false);
    expect(handleReactionUpdate).toHaveBeenCalledWith({ messageId: 'message-1' });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(onReplace).toHaveBeenCalledWith('/?error=session_expired');
    expect(showRejectedMessage).toHaveBeenCalledWith('blocked');
    vi.useRealTimers();
  });

  it('batches incoming live messages before updating React state', () => {
    vi.useFakeTimers();
    const setMessages = vi.fn();
    const handlers = createRoomEventHandlers({
      mountedRef: { current: true },
      messageProcessingRef: { current: false },
      processedMessageIds: { current: new Set() },
      initialLoadCompletedRef: { current: true },
      processMessages: vi.fn(),
      setRoom: vi.fn(),
      setMessages,
      setLoadingMessages: vi.fn(),
      setError: vi.fn(),
      setHasMoreMessages: vi.fn(),
      cleanup: vi.fn(),
      logout: vi.fn(),
      onReplace: vi.fn(),
      handleReactionUpdate: vi.fn(),
      showRejectedMessage: vi.fn(),
    });

    handlers.onMessage({ _id: 'message-1' });
    handlers.onMessage({ _id: 'message-2' });

    expect(setMessages).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);

    expect(setMessages).toHaveBeenCalledTimes(1);
    expect(setMessages.mock.calls[0][0]([])).toEqual([
      { _id: 'message-1' },
      { _id: 'message-2' },
    ]);
    vi.useRealTimers();
  });

  it('updates read receipts from previousMessagesLoaded participantReadStates', () => {
    const setRoom = vi.fn();
    const processMessages = vi.fn();
    const handlers = createRoomEventHandlers({
      mountedRef: { current: true },
      messageProcessingRef: { current: false },
      processedMessageIds: { current: new Set() },
      initialLoadCompletedRef: { current: false },
      processMessages,
      setRoom,
      setMessages: vi.fn(),
      setLoadingMessages: vi.fn(),
      setError: vi.fn(),
      setHasMoreMessages: vi.fn(),
      cleanup: vi.fn(),
      logout: vi.fn(),
      onReplace: vi.fn(),
      handleReactionUpdate: vi.fn(),
      showRejectedMessage: vi.fn(),
    });

    handlers.onPreviousMessagesLoaded({
      messages: [{ _id: 'message-1' }],
      hasMore: false,
      participantReadStates: [
        { userId: 'user-1', lastReadAt: '2026-07-07T00:00:00.000Z' },
        { userId: 'user-2', lastReadAt: null },
      ],
    });

    expect(processMessages).toHaveBeenCalledWith([{ _id: 'message-1' }], false, true);
    expect(setRoom).toHaveBeenCalledTimes(1);
    expect(setRoom.mock.calls[0][0]({ readReceipts: {} })).toEqual({
      readReceipts: { 'user-1': '2026-07-07T00:00:00.000Z' },
    });
  });
});
