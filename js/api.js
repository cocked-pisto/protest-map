class ProtestApiService {
  constructor() {
    this.activeUserCheckInId = null;
    this.activeUserCheckInSlotId = null;
    this.serverSlot = null;

    // 초기 캐시 기본값 설정 (화면 렌더링 에러 방지)
    this.cachedStats = {
      totalProtesters: 0,
      activeRegionsCount: 0,
      userCheckInsCount: 0,
      lastUpdateTime: new Date()
    };
    this.cachedRegions = [];
    this.cachedMessages = [];
    this.cachedNotices = [];

    this._loadLocalStorage();
    
    // 첫 동기화 실행 및 4초 주기 폴링 가동
    this.syncFromServer();
    this.pollInterval = setInterval(() => this.syncFromServer(), 4000);
  }

  // 세션 스토리지 데이터 로드
  _loadLocalStorage() {
    try {
      this.activeUserCheckInId = sessionStorage.getItem('protest_active_user_checkin_id');
      this.activeUserCheckInSlotId = sessionStorage.getItem('protest_active_user_checkin_slot_id');
    } catch (e) {
      console.error('Failed to load sessionStorage data:', e);
    }
  }

  // 사용자가 이번 타임슬롯에 이미 인증했는지 여부 반환
  hasCheckedInCurrentSlot() {
    if (!this.serverSlot) return false;
    return this.activeUserCheckInSlotId === this.serverSlot.id;
  }

  // 본인 최근 인증 정보 획득
  getUserCheckInCoords() {
    try {
      const data = sessionStorage.getItem('protest_last_user_checkin_coords');
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  // 서버로부터 전체 데이터 가져와 캐시 갱신 및 이벤트 전파
  async syncFromServer() {
    try {
      // 1. 종합 지표 및 회차 정보
      const statsRes = await fetch('/api/stats');
      if (statsRes.ok) {
        this.cachedStats = await statsRes.ok ? await statsRes.json() : this.cachedStats;
        this.serverSlot = this.cachedStats.slot;
      }

      // 2. 활성 거점 목록
      const regionsRes = await fetch('/api/regions');
      if (regionsRes.ok) {
        this.cachedRegions = await regionsRes.json();
      }

      // 3. 실시간 피드 피드 메시지
      const messagesRes = await fetch('/api/messages');
      if (messagesRes.ok) {
        const rawMsgs = await messagesRes.json();
        // 내 메시지 표시 처리 (내 체크인 ID와 일치하는 메시지 마킹)
        this.cachedMessages = rawMsgs.map(m => ({
          ...m,
          time: new Date(m.time),
          isUser: m.id === this.activeUserCheckInId
        }));
      }

      // 3.5. 공지사항 데이터 동기화
      try {
        const noticesRes = await fetch('/api/notices');
        if (noticesRes.ok) {
          this.cachedNotices = await noticesRes.json();
        }
      } catch (e) {
        console.error('Failed to fetch notices:', e);
      }

      // 4. 이벤트 발생시켜 화면 UI 일제 갱신
      window.dispatchEvent(new CustomEvent('protestDataUpdated', {
        detail: {
          stats: this.cachedStats
        }
      }));
    } catch (e) {
      console.error('Server sync failed:', e);
    }
  }

  // 공지사항 목록 가져오기
  getNotices() {
    return this.cachedNotices || [];
  }

  // 현재 슬롯 정보 가져오기
  getCurrentSlot() {
    if (this.serverSlot) {
      return {
        id: this.serverSlot.id,
        label: this.serverSlot.label,
        endDate: new Date(this.serverSlot.endDate)
      };
    }
    const defaultEnd = new Date();
    defaultEnd.setMinutes(defaultEnd.getMinutes() + 1); // fallback
    return { id: "", label: "계산 중...", endDate: defaultEnd };
  }

  // 전국 집계 통계 가져오기
  getOverviewStats() {
    return this.cachedStats;
  }

  // 각 지역별 통계 목록 가져오기
  getRegionsData() {
    return this.cachedRegions;
  }

  // 최근 한줄 메시지 피드 가져오기
  getRecentMessages(limit = 20) {
    return this.cachedMessages.slice(0, limit);
  }

  // 사용자가 "나도 참여하기 (GPS 체크인)" 실행 시 호출
  async registerCheckIn(lat, lng, message) {
    try {
      const response = await fetch('/api/checkin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ lat, lng, message })
      });

      if (!response.ok) {
        throw new Error('Check-in server request failed');
      }

      const result = await response.json();
      if (result.success && result.checkIn) {
        const checkIn = result.checkIn;
        this.activeUserCheckInId = checkIn.id;
        this.activeUserCheckInSlotId = checkIn.slotId;

        // 세션 스토리지에 유저 개인 인증 상태 저장
        try {
          sessionStorage.setItem('protest_active_user_checkin_id', checkIn.id);
          sessionStorage.setItem('protest_active_user_checkin_slot_id', checkIn.slotId);
          sessionStorage.setItem('protest_last_user_checkin_coords', JSON.stringify({
            lat: checkIn.lat,
            lng: checkIn.lng,
            message: checkIn.message
          }));
        } catch (e) {
          console.error('Failed to save to sessionStorage', e);
        }

        // 즉시 동기화 실행하여 인원 카운트 갱신
        await this.syncFromServer();

        // 사용자 피드백 반응을 위한 UI 갱신 이벤트 발생
        window.dispatchEvent(new CustomEvent('protestDataUpdated', {
          detail: {
            newCheckIn: {
              ...checkIn,
              time: new Date(checkIn.time)
            },
            isUserAction: true
          }
        }));

        return checkIn;
      }
    } catch (e) {
      console.error('Check-in registration error:', e);
      throw e;
    }
  }
}

// 싱글톤 패턴으로 내보내기
export const apiService = new ProtestApiService();
export default apiService;
