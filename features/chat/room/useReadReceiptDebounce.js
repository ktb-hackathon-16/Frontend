import { useCallback, useEffect, useRef } from 'react';
import socketClient from '@/lib/socket/socketClient';

/**
 * [ADDED] features/chat/room/useReadReceiptDebounce.js
 *
 * 배경: ReadStatus.js는 메시지마다 독립된 IntersectionObserver를 갖고, 자기
 * 메시지가 화면에 50% 넘게 보이는 순간 곧바로 markMessagesAsRead를 emit했다.
 * 방에 처음 들어가서 화면에 메시지 N개가 동시에 보이면(또는 빠르게 스크롤하면)
 * N개의 observer가 거의 동시에 각자 emit을 쐈고, 백엔드는 emit 1건마다
 * message/user/room findById 3번 + upsert 1번 + room 전체 브로드캐스트 1번을
 * 처리했다(MessageReadHandler.java). 즉 "메시지 개수만큼 서버 호출이 곱해지는" 문제.
 *
 * 실제로 서버에 의미 있는 정보는 "지금까지 읽은 것 중 가장 마지막(최신) 메시지
 * 1개"뿐이다(Last Read Watermark 방식). 그래서 emit 자체를 방(room) 단위로 여기
 * 한 곳에서만 소유하고, 개별 메시지는 "내가 보였다"는 사실만 올려보내게 한다.
 *
 * 동작:
 * 1. handleMessageVisible(messageId, timestamp)가 호출될 때마다, 지금까지
 *    대기 중인 후보(pendingRef)보다 timestamp가 더 최신이면 후보를 교체한다.
 * 2. 호출될 때마다 debounce 타이머를 리셋한다 — 즉 메시지가 연달아 계속
 *    보이는 동안(스크롤 중)은 전송을 미룬다.
 * 3. DEBOUNCE_MS(기본 400ms) 동안 새로 보이는 메시지가 없어야, 그제서야
 *    모아둔 후보 1개로 markMessagesAsRead emit을 1번만 보낸다.
 *
 * 결과: 화면에 메시지 12개가 동시에 보여도 emit은 1번, Mongo 왕복도 4번으로 끝난다.
 */
const DEBOUNCE_MS = 400;

export const useReadReceiptDebounce = ({ roomId, socketRef, currentUserId }) => {
  // 아직 서버로 보내지 않은, 화면에 보인 메시지 중 가장 최신(timestamp가 큰) 것 1개.
  const pendingRef = useRef(null); // { messageId, timestamp } | null
  const timerRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 대기 중인 후보를 실제로 전송한다. debounce 타이머가 만료됐을 때,
  // 또는 방을 나가거나 컴포넌트가 언마운트될 때(마지막 워터마크 유실 방지) 호출된다.
  const flush = useCallback(() => {
    clearTimer();

    const pending = pendingRef.current;
    if (!pending || !roomId) {
      return;
    }

    const socket = socketRef?.current;
    if (!socket?.connected) {
      // 연결이 끊긴 상태면 보내지 않는다. 다음 handleMessageVisible 호출 시
      // 여전히 이 후보가 더 최신이면 다시 pendingRef에 채워져 재시도된다.
      return;
    }

    try {
      socketClient.markMessagesAsRead(roomId, pending.messageId, socket);
    } catch (error) {
      console.error('읽음 워터마크 전송 실패:', error);
    } finally {
      pendingRef.current = null;
    }
  }, [roomId, socketRef, clearTimer]);

  // ReadStatus.js가 "내가 보였다"고 올려보낼 때 호출하는 콜백.
  // 여기서는 emit을 직접 하지 않고, 후보만 갱신 + debounce 타이머만 리셋한다.
  const handleMessageVisible = useCallback((messageId, timestamp) => {
    if (!messageId || !currentUserId) {
      return;
    }

    const ts = Number(timestamp) || 0;
    const pending = pendingRef.current;

    // 이미 대기 중인 후보가 이 메시지보다 최신이거나 같으면 무시한다.
    // 워터마크는 "가장 마지막" 값 하나만 의미가 있어서, 뒤처진 값으로 덮어쓸 필요가 없다.
    if (pending && pending.timestamp >= ts) {
      return;
    }

    pendingRef.current = { messageId, timestamp: ts };

    clearTimer();
    timerRef.current = setTimeout(flush, DEBOUNCE_MS);
  }, [currentUserId, clearTimer, flush]);

  // roomId가 바뀌거나(다른 방으로 이동) 컴포넌트가 사라질 때,
  // 아직 전송 안 된 마지막 워터마크가 있으면 잃어버리지 않도록 즉시 flush한다.
  useEffect(() => {
    return () => {
      flush();
    };
  }, [roomId, flush]);

  return { handleMessageVisible };
};

export default useReadReceiptDebounce;
