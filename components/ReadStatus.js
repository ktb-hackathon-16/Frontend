import React, { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { ConfirmOutlineIcon } from '@vapor-ui/icons';
import { Text, HStack } from '@vapor-ui/core';
import socketClient from '@/lib/socket/socketClient';

// [CHANGED] components/ReadStatus.js — Last Read Watermark 방식으로 재작성.
// Before: 메시지마다 실려오는 readers 배열(누가 이 메시지를 읽었는지 전부 나열)을
//   participants와 비교해서 안읽음 인원을 계산했다.
// After: 서버는 더 이상 메시지별 readers를 보내지 않는다. 대신 room 단위로
//   "유저별 가장 마지막으로 읽은 시각(readReceipts)" 맵 하나만 유지하고,
//   각 메시지는 자기 timestamp를 그 맵과 비교해서 "나(참여자)의 워터마크가
//   이 메시지 시각보다 이전이면 아직 안읽음"으로 판단한다.
// props도 readers -> readReceipts + messageTimestamp + roomId로 바뀌었다.
//
// [CHANGED] (2차) 메시지별 IntersectionObserver가 각자 socketClient.markMessagesAsRead를
// 직접 emit하던 방식의 문제: 방에 처음 들어가서(또는 빠른 스크롤로) 메시지 N개가
// 동시에 50% 이상 보이면, N개의 observer가 거의 동시에 각자 emit을 쐈다. 서버는
// emit 1건마다 findById 3번 + upsert 1번 + room 전체 브로드캐스트 1번을 반복
// 처리해야 했다(MessageReadHandler.java) — 메시지 개수만큼 곱해지는 구조.
//
// onVisible prop을 추가해서, 제공되면 이 컴포넌트는 emit을 직접 하지 않고
// "내가 보였다"는 사실만 상위(room 단위로 하나만 있는 useReadReceiptDebounce 훅)로
// 올려보낸다. 실제 emit은 그 훅이 여러 메시지의 보고를 모아 debounce한 뒤 한 번만
// 보낸다 (참고: features/chat/room/useReadReceiptDebounce.js).
//
// onVisible이 없으면(=상위에서 아직 연결 안 함) 예전처럼 이 컴포넌트가 직접, 즉시
// emit하는 fallback으로 동작한다. socketClient.js에 붙여둔 emit 횟수 로그
// ("[read-receipt] ...")로 이 두 경로의 emit 횟수를 직접 비교할 수 있다 —
// onVisible 연결 전(베이스라인) vs 연결 후(최적화) 콘솔 로그 개수 비교.
const ReadStatus = ({
  messageType = 'text',
  participants = [],
  readReceipts = {},
  messageTimestamp = null,
  roomId = null,
  className = '',
  messageId = null,
  messageRef = null, // 메시지 요소의 ref 추가
  currentUserId = null, // 현재 사용자 ID 추가
  onVisible = null, // [ADDED] 제공되면 emit을 상위(debounce 훅)에 위임, 없으면 예전처럼 직접 emit
  trackVisibility = true
}) => {
  const [hasMarkedAsRead, setHasMarkedAsRead] = useState(false);
  const statusRef = useRef(null);
  const observerRef = useRef(null);

  const hasParticipantRead = useCallback((participantId, watermark) => {
    if (!watermark || messageTimestamp == null) return false;
    return new Date(watermark).getTime() >= new Date(messageTimestamp).getTime();
  }, [messageTimestamp]);

  // 읽지 않은 참여자 명단 생성
  const unreadParticipants = useMemo(() => {
    if (messageType === 'system') return [];

    return participants.filter(participant => {
      const participantId = participant._id || participant.id;
      return !hasParticipantRead(participantId, readReceipts[participantId]);
    });
  }, [participants, readReceipts, messageType, hasParticipantRead]);

  // 읽지 않은 참여자 수 계산
  const unreadCount = useMemo(() => {
    if (messageType === 'system') {
      return 0;
    }
    return unreadParticipants.length;
  }, [unreadParticipants.length, messageType]);

  // [CHANGED] 메시지를 읽음으로 표시하는 함수.
  // onVisible이 있으면 emit을 직접 하지 않고 "내가 보였다"는 사실만 상위로 보고한다
  // (실제 emit은 상위의 useReadReceiptDebounce가 모아서 1번만 처리).
  // onVisible이 없으면(기본값) 예전 동작 그대로 이 컴포넌트가 직접, 즉시 emit한다 —
  // 이 경로가 "메시지별 독립 emit" 베이스라인이다.
  const markMessageAsRead = useCallback(async () => {
    if (!messageId || !roomId || !currentUserId || hasMarkedAsRead || messageType === 'system') {
      return;
    }

    if (typeof onVisible === 'function') {
      // [NEW PATH] emit은 여기서 하지 않는다 — 상위 debounce 훅에 위임.
      onVisible(messageId, messageTimestamp);
      setHasMarkedAsRead(true);
      return;
    }

    // [FALLBACK / 베이스라인 경로] 상위에서 onVisible을 아직 연결하지 않은 경우,
    // 예전처럼 이 메시지 컴포넌트가 직접·즉시 emit한다.
    if (!socketClient.canSend()) {
      return;
    }

    try {
      // Socket.IO를 통해 서버에 읽음 워터마크 전송 ("여기까지 읽었다" 좌표 1개)
      socketClient.markMessagesAsRead(roomId, messageId);

      setHasMarkedAsRead(true);

    } catch (error) {
      console.error('Error marking message as read:', error);
    }
  }, [messageId, roomId, currentUserId, hasMarkedAsRead, messageType, onVisible, messageTimestamp]);

  // Intersection Observer 설정
  useEffect(() => {
    if (!trackVisibility || !messageRef?.current || !currentUserId || hasMarkedAsRead || messageType === 'system') {
      return;
    }

    // 이미 읽은 메시지인지 확인 (내 워터마크가 이 메시지 시각 이후인가)
    const isAlreadyRead = hasParticipantRead(currentUserId, readReceipts[currentUserId]);

    if (isAlreadyRead) {
      setHasMarkedAsRead(true);
      return;
    }

    const observerOptions = {
      root: null,
      rootMargin: '0px',
      threshold: 0.5 // 메시지의 50%가 보여야 읽음으로 처리
    };

    const handleIntersect = (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !hasMarkedAsRead) {
          markMessageAsRead(); // ReadStatus 컴포넌트에서 해당 함수에 의해 백엔드를 얼마나 호출하냐 <- 이거에 대한 베이스라인 관측치를 주세요!!(코드개선 후 비교 하려고 합니다)
        }
      });
    };

    observerRef.current = new IntersectionObserver(handleIntersect, observerOptions);
    observerRef.current.observe(messageRef.current);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [messageRef, currentUserId, hasMarkedAsRead, messageType, readReceipts, hasParticipantRead, markMessageAsRead, trackVisibility]);

  // 시스템 메시지는 읽음 상태 표시 안 함
  if (messageType === 'system') {
    return null;
  }

  // 모두 읽은 경우
  if (unreadCount === 0) {
    return (
      <HStack
        className={className}
        ref={statusRef}
        $css={{ gap: '$050', alignItems: 'center' }}
        role="status"
        aria-label="모든 참여자가 메시지를 읽었습니다"
        data-testid="read-status-all-read"
      >
        <HStack $css={{ alignItems: 'center' }}>
          <ConfirmOutlineIcon size={12} className='text-v-success-100' />
          <ConfirmOutlineIcon size={12} className='-ml-1.5 text-v-success-100' />
        </HStack>
        <Text typography="subtitle2" className="text-v-hint-200">모두 읽음</Text>
      </HStack>
    );
  }

  // 읽지 않은 사람이 있는 경우
  return (
    <HStack
      className={className}
      ref={statusRef}
      $css={{ gap: '$050', alignItems: 'center' }}
      role="status"
      aria-label={`${unreadCount}명이 메시지를 읽지 않았습니다`}
      data-testid="read-status-unread"
    >
      <ConfirmOutlineIcon size={12} className="text-v-hint-200" />
      {unreadCount > 0 && (
        <Text typography="subtitle2" className="text-v-hint-200">
          {unreadCount}명 안 읽음
        </Text>
      )}
    </HStack>
  );
};

export default ReadStatus;
