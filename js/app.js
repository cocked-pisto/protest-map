import { apiService } from './api.js';

// Leaflet 지도 인스턴스 및 마커 레이어 그룹
let map;
let markerLayerGroup;
let userMarker = null;
let lastKnownUserCoords = null;

// 공지사항 슬라이더 상태 변수
let currentNoticeIndex = 0;
let noticesArray = [];
let noticeInterval = null;
let lastNoticesJson = '';

// UI 요소 셀렉터
const totalCountEl = document.getElementById('total-count');
const headerTotalCountEl = document.getElementById('header-total-count');
const headerSlotLabelEl = document.getElementById('header-slot-label');
const headerSlotCountdownEl = document.getElementById('header-slot-countdown');
const activeRegionsEl = document.getElementById('active-regions');
const myCheckinsEl = document.getElementById('my-checkins');
const regionListEl = document.getElementById('region-list');
const feedListEl = document.getElementById('feed-list');

const checkinTriggerBtn = document.getElementById('checkin-trigger');
const mobileFeedToggleBtn = document.getElementById('mobile-feed-toggle');
const mobileRegionsToggleBtn = document.getElementById('mobile-regions-toggle');
const feedCloseBtn = document.getElementById('feed-close-btn');
const dashboardCloseBtn = document.getElementById('dashboard-close-btn');
const feedPanel = document.getElementById('feed-panel');
const dashboardPanel = document.getElementById('dashboard-panel');

// 모달 요소 셀렉터
const checkinModal = document.getElementById('checkin-modal');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalSubmitBtn = document.getElementById('modal-submit-btn');
const checkinMessageInput = document.getElementById('checkin-message');

// 한국 중심 좌표 설정
const KOREA_CENTER = [36.3, 127.8];
const DEFAULT_ZOOM = 7.5;

// 공지사항 데이터 동기화 및 슬라이더 작동 함수
function handleNoticeUpdate() {
  const notices = apiService.getNotices();
  const noticesJson = JSON.stringify(notices);
  if (noticesJson === lastNoticesJson) return; // 변동 없으면 상태 유지
  lastNoticesJson = noticesJson;

  noticesArray = notices;
  const noticeTextEl = document.getElementById('notice-text');
  if (!noticeTextEl) return;

  if (noticesArray.length === 0) {
    noticeTextEl.textContent = '공지사항이 없습니다.';
    if (noticeInterval) {
      clearInterval(noticeInterval);
      noticeInterval = null;
    }
    return;
  }

  // 첫 공지사항 표시
  noticeTextEl.textContent = noticesArray[0];
  currentNoticeIndex = 0;

  // 기존 슬라이더 타이머 초기화
  if (noticeInterval) {
    clearInterval(noticeInterval);
    noticeInterval = null;
  }

  if (noticesArray.length <= 1) return;

  // 슬라이드 애니메이션 주기 실행 (5초)
  noticeInterval = setInterval(() => {
    noticeTextEl.classList.add('slide-out');

    setTimeout(() => {
      currentNoticeIndex = (currentNoticeIndex + 1) % noticesArray.length;
      noticeTextEl.textContent = noticesArray[currentNoticeIndex];

      noticeTextEl.classList.remove('slide-out');
      noticeTextEl.classList.add('slide-in');

      // 리플로우 강제 유발
      noticeTextEl.offsetHeight;

      noticeTextEl.classList.remove('slide-in');
    }, 400); // 0.4초 CSS 트랜지션 동기화
  }, 5000);
}

// 초기화 함수
function init() {
  const loader = document.getElementById('initial-loader');
  const progressFill = document.getElementById('loader-progress');
  const timerEl = document.getElementById('loader-timer');

  // 첫 프레임에서 트랜지션 작동을 위해 약간의 지연 후 width 설정 시작
  setTimeout(() => {
    if (progressFill) progressFill.style.width = '100%';
  }, 100);

  let timeLeft = 5;
  const interval = setInterval(() => {
    timeLeft -= 1;
    if (timerEl) timerEl.textContent = timeLeft;

    if (timeLeft <= 0) {
      clearInterval(interval);
      if (loader) {
        loader.style.opacity = '0';
        loader.style.transition = 'opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
        setTimeout(() => {
          loader.remove();
          runApp();
        }, 600);
      } else {
        runApp();
      }
    }
  }, 1000);
}

// 실제 앱 구동 함수
function runApp() {
  initMap();
  updateDashboard();
  handleNoticeUpdate();
  setupEventListeners();
  startSlotCountdown();
  updateButtonState();

  // 이전에 이번 차수(타임슬롯)에 인증한 기록이 세션에 있으면 마커만 복원
  if (apiService.hasCheckedInCurrentSlot()) {
    const lastCheckIn = apiService.getUserCheckInCoords();
    if (lastCheckIn) {
      setTimeout(() => {
        showUserLocationOnMap(lastCheckIn.lat, lastCheckIn.lng, lastCheckIn.message);
      }, 1000);
    }
  }
}


// 지도 초기화
function initMap() {
  // 1. 지도 객체 생성 (기본 제어버튼 우하단 이동 등 깔끔한 설정)
  map = L.map('map', {
    zoomControl: true,
    minZoom: 6,
    maxZoom: 16
  }).setView(KOREA_CENTER, DEFAULT_ZOOM);

  // 2. 카토DB 다크 타일맵 설정 (매우 수려한 다크 테마 맵)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  // 3. 마커 그룹 레이어 생성 및 추가
  markerLayerGroup = L.layerGroup().addTo(map);

  // 4. 최초 마커 표시
  renderProtestMarkers();
}

// 집회 장소 마커 표시
function renderProtestMarkers() {
  markerLayerGroup.clearLayers();
  const regions = apiService.getRegionsData();

  regions.forEach(region => {
    if (region.totalCount <= 0) return; // 참여자 수가 0명인 거점은 맵에 표시하지 않음

    // 붉은색 맥박(Pulse) 애니메이션을 가진 커스텀 DivIcon 정의
    const pulseIcon = L.divIcon({
      className: 'pulse-marker-wrapper',
      html: `
        <div class="pulse-marker">
          <div class="pulse-core"></div>
          <div class="pulse-ring"></div>
        </div>
      `,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    const popupContent = `
      <div class="popup-content">
        <h3 class="popup-header">${region.name}</h3>
        <p class="popup-desc">${region.description}</p>
        <div class="popup-stat">
          <i class="fa-solid fa-users"></i> 실시간 참여: ${region.totalCount.toLocaleString()}명
        </div>
      </div>
    `;

    const marker = L.marker([region.lat, region.lng], { icon: pulseIcon })
      .bindPopup(popupContent)
      .addTo(markerLayerGroup);

    // 마커 객체를 데이터에 바인딩 (추후 사이드바 클릭 연동 목적)
    region.marker = marker;
  });
}

// 대시보드 데이터 및 리스트 갱신
function updateDashboard() {
  const stats = apiService.getOverviewStats();
  const regions = apiService.getRegionsData();
  const messages = apiService.getRecentMessages();

  // 1. 최상단 종합 지표 숫자 업데이트 (자연스러운 카운터 효과 대체)
  totalCountEl.textContent = stats.totalProtesters.toLocaleString();
  if (headerTotalCountEl) {
    headerTotalCountEl.textContent = stats.totalProtesters.toLocaleString();
  }
  activeRegionsEl.textContent = stats.activeRegionsCount;
  myCheckinsEl.textContent = stats.userCheckInsCount;

  // 2. 좌측 패널: 주요 집회 거점 리스트 렌더링 (인원이 존재하는 곳만 노출)
  regionListEl.innerHTML = '';
  const activeRegionsList = regions.filter(r => r.totalCount > 0);
  
  if (activeRegionsList.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'empty-regions-msg';
    emptyMsg.style.cssText = 'color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 24px 12px; line-height: 1.45;';
    emptyMsg.innerHTML = `<i class="fa-solid fa-circle-info" style="margin-bottom: 6px; font-size: 1.2rem; display: block; color: var(--text-muted);"></i> 현재 회차에 활성화된 집회 거점이 없습니다.<br>첫 번째로 GPS 인증에 참여해 보세요!`;
    regionListEl.appendChild(emptyMsg);
  } else {
    activeRegionsList.sort((a, b) => b.totalCount - a.totalCount).forEach(region => {
      const item = document.createElement('div');
      item.className = 'region-item';
      item.innerHTML = `
        <div class="region-info">
          <span class="region-name">${region.name}</span>
          <span class="region-desc">${region.description}</span>
        </div>
        <span class="region-count">${region.totalCount.toLocaleString()}명</span>
      `;

      // 사이드바 항목 클릭 시, 해당 지역 마커로 이동 및 팝업 오픈
      item.addEventListener('click', () => {
        map.setView([region.lat, region.lng], 10, { animate: true, duration: 1 });
        
        // 모바일인 경우 바텀 시트 닫아주기
        if (dashboardPanel.classList.contains('active-mobile')) {
          dashboardPanel.classList.remove('active-mobile');
        }
        
        // 약간의 딜레이를 주어 화면 이동 후 팝업 오픈
        setTimeout(() => {
          // markerLayerGroup 내에서 해당 좌표와 일치하는 마커 탐색 후 팝업
          markerLayerGroup.eachLayer(layer => {
            const latLng = layer.getLatLng();
            if (latLng.lat === region.lat && latLng.lng === region.lng) {
              layer.openPopup();
            }
          });
        }, 300);
      });

      regionListEl.appendChild(item);
    });
  }

  // 3. 우측 패널: 한줄 의견 피드 렌더링
  feedListEl.innerHTML = '';
  messages.forEach(msg => {
    const item = document.createElement('div');
    item.className = `feed-item ${msg.isUser ? 'user-item' : ''}`;
    
    // 유저 마크업
    const userBadge = msg.isUser ? ' <span style="background:var(--accent-red);color:white;padding:1px 4px;font-size:0.65rem;border-radius:3px;margin-left:4px;">내 위치</span>' : '';
    
    item.innerHTML = `
      <div class="feed-header">
        <span class="feed-region">${msg.regionName}${userBadge}</span>
        <span class="feed-time">${formatRelativeTime(msg.time)}</span>
      </div>
      <div class="feed-text">${escapeHtml(msg.message)}</div>
    `;

    // 피드 아이템 클릭 시, 해당 위치로 지도 포커스 이동
    if (msg.lat && msg.lng) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        map.setView([msg.lat, msg.lng], 13, { animate: true, duration: 1 });
        
        // 유저 마커인 경우 바로 오픈
        if (msg.isUser && userMarker) {
          userMarker.openPopup();
        } else {
          // 해당 지역 근처 마커가 있다면 팝업
          const nearestRegion = apiService.findRegionByCoords(msg.lat, msg.lng);
          if (nearestRegion) {
            markerLayerGroup.eachLayer(layer => {
              const latLng = layer.getLatLng();
              if (latLng.lat === nearestRegion.lat && latLng.lng === nearestRegion.lng) {
                layer.openPopup();
              }
            });
          }
        }

        // 모바일인 경우 피드창 닫아줌
        if (feedPanel.classList.contains('active-mobile')) {
          feedPanel.classList.remove('active-mobile');
        }
      });
    }

    feedListEl.appendChild(item);
  });
}

// 이벤트 리스너 바인딩
function setupEventListeners() {
  // 1. 실시간 데이터 갱신 이벤트 리스너
  window.addEventListener('protestDataUpdated', (e) => {
    const { isUserAction, newCheckIn } = e.detail;

    // 대시보드 정보 갱신
    updateDashboard();
    handleNoticeUpdate();

    // 마커 갱신 (전국 카운트 변동 반영)
    renderProtestMarkers();

    // 이번 차수 참여 버튼 상태 업데이트
    updateButtonState();

    // 유저 본인이 체크인한 직후 반응 처리
    if (isUserAction && newCheckIn) {
      showUserLocationOnMap(newCheckIn.lat, newCheckIn.lng, newCheckIn.message);
    }
  });

  // 2. 나도 참여하기 버튼 클릭 (GPS 권한 및 측위 요청)
  checkinTriggerBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('사용하시는 브라우저는 위치 정보를 제공하지 않습니다.');
      return;
    }

    // 버튼 로딩 상태 표시
    const originalContent = checkinTriggerBtn.innerHTML;
    checkinTriggerBtn.disabled = true;
    checkinTriggerBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 위치 확인 중...`;

    const options = {
      enableHighAccuracy: true, // 고정밀 GPS 수신 요청
      timeout: 10000,
      maximumAge: 0
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        // 성공: 위치 획득
        lastKnownUserCoords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };

        // 로딩 복구 및 모달 오픈
        checkinTriggerBtn.disabled = false;
        checkinTriggerBtn.innerHTML = originalContent;
        
        openCheckInModal();
      },
      (error) => {
        // 실패: 에러 처리
        checkinTriggerBtn.disabled = false;
        checkinTriggerBtn.innerHTML = originalContent;
        
        let errorMsg = 'GPS 위치 정보를 가져올 수 없습니다.';
        switch(error.code) {
          case error.PERMISSION_DENIED:
            errorMsg = '위치 정보 접근 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해 주세요.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMsg = '현재 위치 신호를 감지할 수 없습니다. 실내에 계신 경우 GPS 연결이 원활하지 않을 수 있습니다.';
            break;
          case error.TIMEOUT:
            errorMsg = '위치 획득 제한 시간을 초과했습니다. 다시 시도해 주세요.';
            break;
        }
        alert(errorMsg + '\n\n(※ 참고: 로컬 파일 직접 열기 대신 웹 서버 환경이나 HTTPS 연결에서만 정상 동작할 수 있습니다.)');
      },
      options
    );
  });

  // 3. 모달 제어
  modalCancelBtn.addEventListener('click', closeCheckInModal);
  
  modalSubmitBtn.addEventListener('click', async () => {
    if (!lastKnownUserCoords) return;

    const message = checkinMessageInput.value;
    
    // 버튼 로딩 상태 표시
    const originalContent = modalSubmitBtn.innerHTML;
    modalSubmitBtn.disabled = true;
    modalSubmitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 등록 중...`;

    try {
      // GPS 체크인 최종 등록 (비동기 역지오코딩 포함)
      await apiService.registerCheckIn(
        lastKnownUserCoords.lat,
        lastKnownUserCoords.lng,
        message
      );
    } catch (err) {
      console.error('Check-in failed:', err);
      alert('참여 등록에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      // 로딩 상태 복구 및 모달 닫기
      modalSubmitBtn.disabled = false;
      modalSubmitBtn.innerHTML = originalContent;
      closeCheckInModal();
      
      // 버튼 상태 비활성화 업데이트
      updateButtonState();
    }
  });

  // 모달 영역 외곽 클릭 시 닫기
  checkinModal.addEventListener('click', (e) => {
    if (e.target === checkinModal) {
      closeCheckInModal();
    }
  });

  // 4. 모바일 화면 전환 제어
  mobileFeedToggleBtn.addEventListener('click', () => {
    feedPanel.classList.add('active-mobile');
    dashboardPanel.classList.remove('active-mobile'); // 피드 활성화 시 거점 목록 닫기
  });

  feedCloseBtn.addEventListener('click', () => {
    feedPanel.classList.remove('active-mobile');
  });

  mobileRegionsToggleBtn.addEventListener('click', () => {
    dashboardPanel.classList.add('active-mobile');
    feedPanel.classList.remove('active-mobile'); // 거점 목록 활성화 시 피드 닫기
  });

  dashboardCloseBtn.addEventListener('click', () => {
    dashboardPanel.classList.remove('active-mobile');
  });
}

// 모달 제어 함수
function openCheckInModal() {
  checkinMessageInput.value = '';
  checkinModal.classList.add('active');
  checkinMessageInput.focus();
}

function closeCheckInModal() {
  checkinModal.classList.remove('active');
}

// 사용자 본인 위치 지도 표시 및 이동
function showUserLocationOnMap(lat, lng, message) {
  // 기존 사용자 마커 제거
  if (userMarker) {
    map.removeLayer(userMarker);
  }

  // 초록색 맥박(Pulse) 애니메이션을 가진 커스텀 DivIcon 정의 (유저용)
  const userIcon = L.divIcon({
    className: 'pulse-marker-wrapper user-marker',
    html: `
      <div class="pulse-marker">
        <div class="pulse-core"></div>
        <div class="pulse-ring"></div>
      </div>
    `,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });

  const popupContent = `
    <div class="popup-content" style="max-width: 220px;">
      <h3 class="popup-header" style="color:var(--accent-green);"><i class="fa-solid fa-street-view"></i> 내 인증 위치</h3>
      <p class="popup-desc" style="color: var(--accent-green); font-weight: 600; margin-bottom: 4px;">이번 차수 참여 인증 완료</p>
      <p style="font-size:0.7rem; color:var(--text-muted); line-height: 1.35; margin-bottom: 6px;">
        <i class="fa-solid fa-eye-slash"></i> 이 초록색 핀(상세 위치)은 본인에게만 보입니다. 타인에게는 약 1km 오차가 적용된 익명화 거점(빨간색 핀)으로 안전하게 합산되어 나타납니다.
      </p>
      ${message ? `<div style="font-size:0.8rem;background:rgba(255,255,255,0.05);padding:6px 10px;border-radius:6px;border:1px solid var(--border-color);margin-top:6px;word-break:break-all;">"${escapeHtml(message)}"</div>` : ''}
    </div>
  `;

  // 유저 마커 추가 및 지도 이동
  userMarker = L.marker([lat, lng], { icon: userIcon })
    .bindPopup(popupContent)
    .addTo(map);

  map.setView([lat, lng], 13, { animate: true, duration: 1.5 });
  
  setTimeout(() => {
    userMarker.openPopup();
  }, 1500);
}

// 상대 시간 텍스트 변환 헬퍼
function formatRelativeTime(date) {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return '방금 전';
  if (diffMins < 60) return `${diffMins}분 전`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;
  
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

// HTML 이스케이프 헬퍼 (XSS 방지)
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 버튼 활성화/비활성화 상태 업데이트 함수
function updateButtonState() {
  const hasCheckedIn = apiService.hasCheckedInCurrentSlot();
  const syncStatusEl = document.getElementById('sync-status');
  const syncDotEl = document.getElementById('sync-dot');

  if (hasCheckedIn) {
    checkinTriggerBtn.disabled = true;
    checkinTriggerBtn.style.opacity = '0.6';
    checkinTriggerBtn.style.pointerEvents = 'none';
    checkinTriggerBtn.style.background = 'linear-gradient(135deg, #475569, #334155)';
    checkinTriggerBtn.style.boxShadow = 'none';
    
    // 버튼 텍스트 및 아이콘 변경
    const span = checkinTriggerBtn.querySelector('span');
    const icon = checkinTriggerBtn.querySelector('i');
    if (span) span.textContent = '이번 차수 인증 완료';
    if (icon) {
      icon.className = 'fa-solid fa-circle-check';
      icon.style.color = 'var(--accent-green)';
    }

    if (syncStatusEl) {
      syncStatusEl.textContent = '이번 회차 인증이 완료되었습니다';
    }
    if (syncDotEl) {
      syncDotEl.style.boxShadow = '0 0 12px var(--accent-green)';
      syncDotEl.style.backgroundColor = 'var(--accent-green)';
    }
  } else {
    checkinTriggerBtn.disabled = false;
    checkinTriggerBtn.style.opacity = '1';
    checkinTriggerBtn.style.pointerEvents = 'auto';
    checkinTriggerBtn.style.background = 'linear-gradient(135deg, #ef4444, #ea580c)';
    checkinTriggerBtn.style.boxShadow = '0 10px 30px rgba(239, 68, 68, 0.4)';
    
    const span = checkinTriggerBtn.querySelector('span');
    const icon = checkinTriggerBtn.querySelector('i');
    if (span) span.textContent = '나도 참여하기 (GPS 인증)';
    if (icon) {
      icon.className = 'fa-solid fa-hand-fist';
      icon.style.color = '';
    }

    if (syncStatusEl) {
      syncStatusEl.textContent = '실시간 데이터 수신 중';
    }
    if (syncDotEl) {
      syncDotEl.style.boxShadow = '0 0 8px var(--accent-green)';
      syncDotEl.style.backgroundColor = 'var(--accent-green)';
    }
  }
}

// 3시간 단위 타임슬롯 카운트다운 함수
function startSlotCountdown() {
  setInterval(() => {
    const slot = apiService.getCurrentSlot();
    const now = new Date();
    const diffMs = slot.endDate.getTime() - now.getTime();
    
    if (diffMs <= 0) {
      // 다음 슬롯으로 전환되었으므로 전체 대시보드 갱신
      updateDashboard();
      renderProtestMarkers();
      updateButtonState();
      return;
    }
    
    const hours = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    const secs = Math.floor((diffMs % 60000) / 1000);
    
    const countdownStr = `다음 회차까지: ${hours.toString().padStart(2,'0')}시간 ${mins.toString().padStart(2,'0')}분 ${secs.toString().padStart(2,'0')}초`;
    
    const slotCountdownEl = document.getElementById('slot-countdown');
    if (slotCountdownEl) {
      slotCountdownEl.textContent = countdownStr;
    }
    
    const slotLabelEl = document.getElementById('slot-label');
    if (slotLabelEl) {
      slotLabelEl.textContent = `현재 회차: ${slot.label}`;
    }

    // 헤더 및 모바일 겸용 시간 동기화
    const stats = apiService.getOverviewStats();
    if (headerTotalCountEl) {
      headerTotalCountEl.textContent = stats.totalProtesters.toLocaleString();
    }
    if (headerSlotLabelEl) {
      headerSlotLabelEl.textContent = slot.label;
    }
    if (headerSlotCountdownEl) {
      headerSlotCountdownEl.textContent = `${hours.toString().padStart(2,'0')}:${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')} 남음`;
    }
  }, 1000);
}

// 페이지 로드 시 시작
window.addEventListener('DOMContentLoaded', init);
