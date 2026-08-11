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
const ReadStatus = ({
  messageType = 'text',
  participants = [],
  readReceipts = {},
  messageTimestamp = null,
  roomId = null,
  className = '',
  messageId = null,
  messageRef = null, // 메시지 요소의 ref 추가
  currentUserId = null // 현재 사용자 ID 추가
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

  // 메시지를 읽음으로 표시하는 함수
  const markMessageAsRead = useCallback(async () => {
    if (!messageId || !roomId || !currentUserId || hasMarkedAsRead ||
        messageType === 'system' || !socketClient.canSend()) {
      return;
    }

    try {
      // Socket.IO를 통해 서버에 읽음 워터마크 전송 ("여기까지 읽었다" 좌표 1개)
      socketClient.markMessagesAsRead(roomId, messageId);

      setHasMarkedAsRead(true);

    } catch (error) {
      console.error('Error marking message as read:', error);
    }
  }, [messageId, roomId, currentUserId, hasMarkedAsRead, messageType]);

  // Intersection Observer 설정
  useEffect(() => {
    if (!messageRef?.current || !currentUserId || hasMarkedAsRead || messageType === 'system') {
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
          markMessageAsRead();
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
  }, [messageRef, currentUserId, hasMarkedAsRead, messageType, readReceipts, hasParticipantRead, markMessageAsRead]);

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
