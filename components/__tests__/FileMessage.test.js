import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FileMessage from '../FileMessage';
import fileService from '@/services/fileService';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      token: 'token',
      sessionId: 'session-id',
    },
  }),
}));

vi.mock('@/services/fileService', () => ({
  default: {
    getPreviewUrl: vi.fn(() => 'https://api.example.com/api/files/view/fallback.jpg'),
    getFileUrl: vi.fn(() => 'https://api.example.com/api/files/view/file.jpg'),
    formatFileSize: vi.fn(() => '1 MB'),
  },
}));

vi.mock('../CustomAvatar', () => ({
  default: () => React.createElement('div', { 'data-testid': 'avatar' }),
}));

vi.mock('../MessageContent', () => ({
  default: ({ content }) => React.createElement('span', null, content),
}));

vi.mock('../MessageActions', () => ({
  default: () => React.createElement('div', { 'data-testid': 'message-actions' }),
}));

vi.mock('../FileActions', () => ({
  default: () => React.createElement('div', { 'data-testid': 'file-actions' }),
}));

vi.mock('../ReadStatus', () => ({
  default: () => React.createElement('div', { 'data-testid': 'read-status' }),
}));

const baseMessage = {
  _id: 'message-1',
  content: '파일 업로드 부하 테스트 1',
  timestamp: '2026-08-11T18:45:52.749Z',
  type: 'file',
  sender: {
    _id: 'user-1',
    name: 'tester',
  },
  file: {
    filename: 'test.jpg',
    originalname: 'test.jpg',
    mimetype: 'image/jpeg',
    size: 1024,
    previewUrl: 'https://cdn.example.com/media/chat/previews/test-preview.jpg',
  },
};

describe('FileMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the CDN preview URL before falling back to the authenticated file view URL', () => {
    render(
      React.createElement(FileMessage, {
        msg: baseMessage,
        currentUser: { _id: 'user-1' },
        isMine: true,
      })
    );

    expect(screen.getByTestId('file-image-preview')).toHaveAttribute(
      'src',
      baseMessage.file.previewUrl
    );
    expect(fileService.getPreviewUrl).not.toHaveBeenCalled();
  });

  it('keeps the file message text visible when the image preview fails', () => {
    render(
      React.createElement(FileMessage, {
        msg: baseMessage,
        currentUser: { _id: 'user-1' },
        isMine: true,
      })
    );

    fireEvent.error(screen.getByTestId('file-image-preview'));

    expect(screen.getByText('파일 업로드 부하 테스트 1')).toBeInTheDocument();
    expect(screen.getByText('이미지를 불러올 수 없습니다.')).toBeInTheDocument();
  });
});
