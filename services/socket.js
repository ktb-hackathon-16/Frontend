import { io } from 'socket.io-client';

// 소켓 정리를 수행하는 이유를 정의한 상수 (연결 끊김, 수동 종료, 재연결)
const CLEANUP_REASONS = {
  DISCONNECT: 'disconnect',
  MANUAL: 'manual',
  RECONNECT: 'reconnect'
};

/**
 * 실시간 통신(Socket.io)을 관리하는 클래스입니다.
 * 앱 전체에서 단일 인스턴스(Singleton)로 동작하여 불필요한 중복 연결을 방지합니다.
 */
export class SocketService {
  constructor() {
    this.socket = null;               // 현재 연결된 socket.io 인스턴스
    this.reconnectAttempts = 0;       // 현재 재연결 시도 횟수
    this.maxReconnectAttempts = 5;    // 최대 허용 재연결 횟수
    this.isReconnecting = false;      // 현재 재연결 진행 여부
    this.connectionPromise = null;    // 중복 연결 방지를 위한 비동기 연결 상태 Promise
    this.connectionReject = null;     // 연결 실패 시 호출될 거절(reject) 함수
    this.connectionTimeout = null;    // 연결 타임아웃 타이머
    this.retryDelay = 1000;           // 재연결 시도 간격 (기본 1초)
    this.connected = false;           // 소켓 연결 상태
  }

  /**
   * 서버와 웹소켓 연결을 시작합니다.
   * 이미 연결 중이거나 연결된 상태라면 기존 연결을 재사용합니다.
   */
  async connect(options = {}) {
    // 연결을 시도하는 중이라면 해당 진행 상황(Promise)을 바로 반환 (동시 연결 방지)
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    // 이미 연결이 완료된 상태라면 현재 소켓 인스턴스를 반환
    if (this.socket?.connected) {
      return Promise.resolve(this.socket);
    }

    // 새로운 연결을 위한 Promise 생성
    const connectionPromise = new Promise((resolve, reject) => {
      let socket = null;

        // 성공 시
      const resolveConnection = (connectedSocket) => {
        if (connectedSocket !== this.socket) {
          return;
        }

        this.clearConnectionTimeout();
        this.connectionReject = null;
        resolve(connectedSocket);
      };

       // 실패 시
      const rejectConnection = (error, failedSocket = socket) => {
        if (failedSocket && failedSocket !== this.socket) {
          return;
        }

        this.clearConnectionTimeout();
        this.connectionReject = null;
        this.cleanupSocket(failedSocket);
        reject(error);
      };


      try {
        // 1. 기존 연결 정리 (만약 남아있는 연결이 있다면 확실하게 끊고 버립니다)
        if (this.socket) {
          this.cleanupSocket(this.socket);
        }

        // 2. 서버 주소 가져오기 (환경 변수에서 서버의 웹소켓 URL을 가져옵니다)
        const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;

        // 3. 실제 소켓 연결 생성 (전화 걸기)
        socket = io(socketUrl, {
          ...options,
          transports: ['websocket', 'polling'], // 연결 방식: 웹소켓 우선 시도, 실패시 폴링(주기적 요청) 사용
          reconnection: true,                   // 끊어지면 자동 재연결 활성화
          reconnectionAttempts: this.maxReconnectAttempts, // 최대 재연결 시도 횟수 (5번)
          reconnectionDelay: this.retryDelay,   // 재연결 시도 간격 (기본 1초)
          reconnectionDelayMax: 5000,           // 재연결 시도 최대 간격 (점점 늘어나서 최대 5초)
          timeout: 20000,                       // 20초 안에 응답이 없으면 연결 실패 처리
          forceNew: true                        // 기존 연결을 재사용하지 않고 무조건 새 연결(새 전화선)을 생성
        });
        
        // 4. 생성된 소켓을 클래스 변수에 저장하여 앱 전체에서 쓸 수 있게 합니다
        this.socket = socket;
        
        // 5. 연결 과정에서 에러가 발생했을 때(Reject) 호출될 함수를 등록합니다
        this.connectionReject = (error) => rejectConnection(error, socket);
        
        // 6. 무한정 기다리는 것을 막기 위한 타이머(30초) 설정
        this.connectionTimeout = setTimeout(() => {
          if (socket !== this.socket) {
            return; // 그 사이에 소켓 인스턴스가 바뀌었다면 현재 타이머는 무시
          }

          if (!socket.connected) {
            // 30초가 지났는데도 연결이 안 되어 있다면 '타임아웃' 에러 발생
            rejectConnection(new Error('Connection timeout'), socket);
          }
        }, 30000);

        // 7. 연결 성공/실패/에러 등을 감지하는 이벤트 리스너들을 부착합니다
        this.setupEventHandlers(socket, resolveConnection, rejectConnection);

      } catch (error) {
        rejectConnection(error, socket);
      }
    }).finally(() => {
      if (this.connectionPromise === connectionPromise) {
        this.connectionPromise = null;
      }
    });

    this.connectionPromise = connectionPromise;
    return this.connectionPromise;
  }

  /**
   * 소켓에서 발생하는 주요 이벤트들(연결, 에러, 끊김 등)에 대한 동작을 설정합니다.
   */
  setupEventHandlers(socket, resolve, reject) {
    // 1. 정상적으로 연결이 완료되었을 때의 이벤트
    socket.on('connect', () => {
      if (socket !== this.socket) {
        return;
      }

      this.connected = true;
      this.reconnectAttempts = 0; // 연결 성공 시 재연결 시도 횟수 초기화
      this.isReconnecting = false;
      resolve(socket);
    });

    socket.on('disconnect', (reason) => {
      if (socket !== this.socket) {
        return;
      }

      this.connected = false;
      this.cleanup(CLEANUP_REASONS.DISCONNECT);
    });

    socket.on('connect_error', (error) => {
      if (socket !== this.socket) {
        return;
      }

      console.log('Socket connection error:', error.message);
      if (error.message === 'Invalid session') {
        reject(error, socket);
        return;
      }
      if (error.message === 'websocket error') {
        this.reconnectAttempts++;
      }

      // 최초 연결 중일 때만 여기서 실패를 확정한다(connectionReject 가 살아 있는 동안).
      // 이미 연결됐던 소켓의 재시도 실패까지 여기서 끊으면 socket.io 의 재연결이
      // 중단돼 reconnect_failed 가 발생하지 못하고, 서버가 돌아와도 다시 붙지 않는다.
      if (this.connectionReject && this.reconnectAttempts >= this.maxReconnectAttempts) {
        reject(error, socket);
      }
    });

    // duplicate_login 이벤트 수신
    // type: 'new_login_attempt' - 새로 로그인한 디바이스
    // type: 'existing_session' - 기존 세션이 있던 디바이스 (다른 곳에서 로그인함)
    socket.on('duplicate_login', (data) => {
      if (socket !== this.socket) {
        return;
      }

      // TODO: 향후 중복 로그인 처리 필요 시 AuthContext에서 구현
    });

    socket.on('error', (error) => {
      if (socket !== this.socket) {
        return;
      }

      this.handleSocketError(error);
    });

    socket.io.on('reconnect', (attemptNumber) => {
      if (socket !== this.socket) {
        return;
      }

      this.connected = true;
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
    });

    socket.io.on('reconnect_failed', () => {
      if (socket !== this.socket) {
        return;
      }

      reject(new Error('Reconnection failed'), socket);
    });
  }

  clearConnectionTimeout() {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
  }

  cleanupSocket(socket) {
    if (!socket) {
      return;
    }

    if (socket === this.socket) {
      this.socket = null;
      this.connected = false;
    }

    socket.disconnect();
  }

  rejectPendingConnection(error) {
    if (!this.connectionReject) {
      this.clearConnectionTimeout();
      return;
    }

    const reject = this.connectionReject;
    this.connectionReject = null;
    this.clearConnectionTimeout();
    reject(error);
  }

  /**
   * 소켓 연결과 관련된 상태 및 타이머를 초기화/정리합니다.
   * @param {string} reason 정리하는 이유 (수동, 끊김, 재연결 등)
   */
  cleanup(reason = CLEANUP_REASONS.MANUAL) {
    // 연결 끊김 이벤트가 발생했지만 이미 재연결을 시도 중이라면 무시합니다.
    if (reason === CLEANUP_REASONS.DISCONNECT && this.isReconnecting) {
      return;
    }

    if (reason !== CLEANUP_REASONS.RECONNECT) {
      this.rejectPendingConnection(new Error('Connection disconnected'));
    }

    if (reason === CLEANUP_REASONS.MANUAL && this.socket) {
      this.cleanupSocket(this.socket);
    }

    if (reason === CLEANUP_REASONS.MANUAL) {
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      this.connectionPromise = null;
      this.connected = false;
    }
  }

  disconnect() {
    this.cleanup(CLEANUP_REASONS.MANUAL);
    if (this.socket) {
      this.cleanupSocket(this.socket);
    }
  }

  handleSocketError(error) {
    if (error.type === 'TransportError') {
      const reconnectAttempt = this.reconnect();
      if (reconnectAttempt?.catch) {
        reconnectAttempt.catch((reconnectError) => {
          console.log('Socket reconnect failed:', reconnectError.message);
        });
      }
    }
  }

  /**
   * 서버로 특정 이벤트와 데이터를 전송합니다.
   * @example socketService.send('send_message', { text: '안녕하세요' })
   */
  send(event, data) {
    if (!this.socket?.connected) {
      throw new Error('Socket is not connected');
    }

    this.socket.emit(event, data);
  }

  sendOn(socket, event, data) {
    if (!socket?.connected) {
      throw new Error('Socket is not connected');
    }

    socket.emit(event, data);
  }

  trySendOn(socket, event, data) {
    if (!socket?.connected) {
      return false;
    }

    try {
      socket.emit(event, data);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 수동으로 소켓 재연결을 시도합니다.
   */
  async reconnect() {
    // 이미 재연결 중이라면 중복 실행 방지
    if (this.isReconnecting) return;

    this.isReconnecting = true;
    this.rejectPendingConnection(new Error('Connection disconnected')); // 기존 연결 취소
    this.connectionPromise = null;

    if (this.socket) {
      this.cleanupSocket(this.socket);
    }

    try {
      await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      await this.connect();
    } catch (error) {
      this.isReconnecting = false;
      throw error;
    }
  }

  isConnected() {
    return this.connected && this.socket?.connected;
  }
}

const socketService = new SocketService();

export default socketService;
