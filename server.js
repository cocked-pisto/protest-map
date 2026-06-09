import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { REGIONS } from './js/regions.js';

// ES Module __dirname 대체 설정
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// 미들웨어 설정
app.use(cors());
app.use(express.json());

// 디버그 및 테스트 모드 플래그 (true인 경우 1분마다 회차 만료/리셋 및 버튼 활성화 테스트 가능)
const TEST_MODE = false; 

const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');

// data 디렉토리 생성
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// 가상 피드 메시지 템플릿
const SIMULATED_TEMPLATES = [
  { message: '현재 참가 인원이 폭발적으로 늘고 있습니다. 다들 조심히 오세요!' },
  { message: '나라의 주권은 국민에게 있습니다. 부정선거 절대 묵과할 수 없습니다.' },
  { message: '공정선거 쟁취를 위한 평화 시위! 대열 정비 완료했습니다.' },
  { message: '피켓 무료 나눔 중입니다. 본부 텐트 쪽으로 오셔서 받아가세요!' },
  { message: '생수와 간식 후원 받았습니다. 안내소에서 나눠드리고 있습니다.' },
  { message: '자유 발언대 참여하실 분들은 운영진 메가폰 쪽으로 신청해 주세요.' },
  { message: '질서 정연하게 쓰레기 봉투 나눠 들고 주변 정리하며 진행 중입니다. 모범 시민 최고!' }
];

// 초기 DB 상태 구조 정의
let db = {
  activeSlotId: "",
  regions: JSON.parse(JSON.stringify(REGIONS)),
  checkIns: [],
  messages: []
};

// DB 데이터 로드
function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(data);
      db = {
        ...db,
        ...parsed,
        checkIns: (parsed.checkIns || []).map(c => ({ ...c, time: new Date(c.time) })),
        messages: (parsed.messages || []).map(m => ({ ...m, time: new Date(m.time) }))
      };
    } catch (e) {
      console.error("Failed to load db file, using defaults:", e);
    }
  }
  checkAndResetSlot();
}

// DB 데이터 저장
function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error("Failed to save db file:", e);
  }
}

// 타임슬롯 계산 함수
function getCurrentSlot() {
  const now = new Date();
  
  if (TEST_MODE) {
    // 1분 단위 단축 테스트 슬롯
    const start = new Date(now);
    start.setSeconds(0, 0);
    
    const end = new Date(start);
    end.setMinutes(start.getMinutes() + 1);
    
    const slotId = `test_${start.getFullYear()}${(start.getMonth()+1).toString().padStart(2,'0')}${start.getDate().toString().padStart(2,'0')}_${start.getHours().toString().padStart(2,'0')}${start.getMinutes().toString().padStart(2,'0')}`;
    const label = `${start.getHours().toString().padStart(2,'0')}:${start.getMinutes().toString().padStart(2,'0')} ~ ${end.getHours().toString().padStart(2,'0')}:${end.getMinutes().toString().padStart(2,'0')} (테스트)`;
    
    return { id: slotId, label, startDate: start, endDate: end };
  } else {
    // 3시간 단위 실제 슬롯
    const hour = now.getHours();
    const startHour = Math.floor(hour / 3) * 3;
    const endHour = startHour + 3;
    
    const start = new Date(now);
    start.setHours(startHour, 0, 0, 0);
    
    const end = new Date(now);
    if (endHour === 24) {
      end.setDate(now.getDate() + 1);
      end.setHours(0, 0, 0, 0);
    } else {
      end.setHours(endHour, 0, 0, 0);
    }
    
    const slotId = `${start.getFullYear()}${(start.getMonth()+1).toString().padStart(2,'0')}${start.getDate().toString().padStart(2,'0')}_${startHour.toString().padStart(2,'0')}`;
    const label = `${startHour.toString().padStart(2,'0')}:00 ~ ${endHour === 24 ? '24' : endHour.toString().padStart(2,'0')}:00`;
    
    return { id: slotId, label, startDate: start, endDate: end };
  }
}

// 회차 유효성 검사 및 만료 시 리셋 처리
function checkAndResetSlot() {
  const currentSlot = getCurrentSlot();
  if (db.activeSlotId !== currentSlot.id) {
    console.log(`[Slot Changed] ${db.activeSlotId || 'None'} -> ${currentSlot.id}. Resetting slot data.`);
    db.activeSlotId = currentSlot.id;
    // 거점 인원 초기화
    db.regions = JSON.parse(JSON.stringify(REGIONS));
    // 실시간 데이터 리셋
    db.checkIns = [];
    
    // 새 회차 초기 안내용 가상 한줄의견 삽입
    db.messages = [
      { 
        id: 'm_init_1', 
        regionId: 'seoul_jamsil', 
        regionName: '서울 잠실 (송파)', 
        message: '새 회차가 시작되었습니다! 현장에 계신 시민분들은 GPS 인증에 동참해 주세요.', 
        time: new Date(),
        lat: 37.5133,
        lng: 127.1001
      }
    ];
    saveDb();
  }
}

// 거리 계산 및 가장 가까운 거점 탐색 (3km 이내)
function findNearestRegion(lat, lng) {
  let minDistance = Infinity;
  let nearestRegion = null;

  db.regions.forEach(region => {
    const dy = lat - region.lat;
    const dx = (lng - region.lng) * Math.cos(lat * Math.PI / 180);
    const distance = Math.sqrt(dx * dx + dy * dy) * 111000;

    if (distance < minDistance) {
      minDistance = distance;
      nearestRegion = region;
    }
  });

  if (minDistance < 3000) {
    return nearestRegion;
  }
  return null;
}

// Nominatim OpenStreetMap API 역지오코딩 (개인정보 보호를 위해 구/시 단위까지만 추출)
async function reverseGeocode(lat, lng) {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ko`, {
      headers: {
        'User-Agent': 'ProtestMapApp/1.0'
      }
    });
    if (response.ok) {
      const data = await response.json();
      if (data && data.address) {
        const addr = data.address;
        
        // 광역시/도 이름 추출 및 축약 (예: 서울특별시 -> 서울)
        const city = addr.city || addr.province || addr.metropolitan || addr.municipality || '';
        // 시/군/구 이름 추출 (예: 송파구, 분당구, 수원시)
        const district = addr.borough || addr.suburb || addr.district || addr.county || addr.city_district || '';
        
        let nameParts = [];
        if (city) {
          nameParts.push(city.replace(/(특별시|광역시|특별자치시|도)$/, ''));
        }
        if (district) {
          nameParts.push(district);
        }
        
        if (nameParts.length > 0) {
          return nameParts.join(' ') + ' 인근';
        }
        if (data.display_name) {
          return data.display_name.split(',')[0] + ' 인근';
        }
      }
    }
  } catch (e) {
    console.error('Server reverse geocoding failed:', e);
  }
  return null;
}

// 오프라인 로컬 지오코더
function getLocalRegionName(lat, lng) {
  const cities = [
    { name: "서울", lat: 37.56, lng: 126.97 },
    { name: "부산", lat: 35.17, lng: 129.07 },
    { name: "대구", lat: 35.87, lng: 128.60 },
    { name: "인천", lat: 37.45, lng: 126.70 },
    { name: "광주", lat: 35.15, lng: 126.85 },
    { name: "대전", lat: 36.35, lng: 127.38 },
    { name: "울산", lat: 35.53, lng: 129.31 },
    { name: "세종", lat: 36.48, lng: 127.28 },
    { name: "경기", lat: 37.4, lng: 127.1 },
    { name: "강원", lat: 37.7, lng: 128.3 },
    { name: "충북", lat: 36.6, lng: 127.8 },
    { name: "충남", lat: 36.5, lng: 126.8 },
    { name: "전북", lat: 35.8, lng: 127.1 },
    { name: "전남", lat: 34.8, lng: 126.9 },
    { name: "경북", lat: 36.3, lng: 128.7 },
    { name: "경남", lat: 35.2, lng: 128.6 },
    { name: "제주", lat: 33.4, lng: 126.5 }
  ];
  
  let nearestCity = "신규 집회";
  let minDist = Infinity;
  
  cities.forEach(city => {
    const dy = lat - city.lat;
    const dx = (lng - city.lng) * Math.cos(lat * Math.PI / 180);
    const dist = Math.sqrt(dx * dx + dy * dy) * 111000;
    if (dist < minDist) {
      minDist = dist;
      nearestCity = city.name;
    }
  });
  
  return `${nearestCity} 인증 지역`;
}

// 동적 거점 생성 (개인정보 보호를 위해 위경도에 랜덤 오프셋 500m~1km 노이즈 추가)
async function createDynamicRegion(lat, lng) {
  let name = await reverseGeocode(lat, lng);
  if (!name) {
    name = getLocalRegionName(lat, lng);
  }

  // 위경도 랜덤 오프셋 추가 (약 500m ~ 1km 오차 적용)
  // 한국 위도 기준: 0.001도 ≈ 111m, 경도 기준: 0.001도 ≈ 88m
  const latOffset = (Math.random() * 0.012 - 0.006); // -660m ~ +660m
  const lngOffset = (Math.random() * 0.014 - 0.007); // -610m ~ +610m
  const fuzzedLat = lat + latOffset;
  const fuzzedLng = lng + lngOffset;

  const id = 'dynamic_' + Date.now();
  const newRegion = {
    id: id,
    name: name,
    lat: fuzzedLat,
    lng: fuzzedLng,
    baseCount: Math.floor(Math.random() * 150) + 50, // 최초 개설 시 기본 가상 참여자 시뮬레이션 설정
    description: '시민 직접 인증 거점'
  };

  db.regions.push(newRegion);
  return newRegion;
}

// 4초 간격 서버 사이드 실시간 가상 참여자 수 및 메시지 변동 시뮬레이터
function startSimulation() {
  setInterval(() => {
    checkAndResetSlot();
    
    // 1. 각 활성화 지역 인원 미세 변동
    db.regions.forEach(region => {
      const change = Math.floor(Math.random() * 9) - 4; // -4 ~ +4
      region.baseCount = Math.max(10, region.baseCount + change);
    });

    // 2. 20% 확률로 가상 참여 한줄의견 게시
    if (Math.random() < 0.20 && db.regions.length > 0) {
      const randomRegion = db.regions[Math.floor(Math.random() * db.regions.length)];
      const template = SIMULATED_TEMPLATES[Math.floor(Math.random() * SIMULATED_TEMPLATES.length)];
      
      const simLat = randomRegion.lat + (Math.random() * 0.003 - 0.0015);
      const simLng = randomRegion.lng + (Math.random() * 0.003 - 0.0015);

      const newMsg = {
        id: 'sim_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        regionId: randomRegion.id,
        regionName: randomRegion.name,
        message: template.message,
        time: new Date(),
        lat: simLat,
        lng: simLng
      };

      db.messages.unshift(newMsg);
      
      // 최대 100개 피드 유지
      if (db.messages.length > 100) {
        db.messages.pop();
      }

      // 기지 카운터 가산
      randomRegion.baseCount += Math.floor(Math.random() * 3) + 1;
    }
    
    saveDb();
  }, 4000);
}

// API 라우터 구현

// 1. 종합 통계 API
app.get('/api/stats', (req, res) => {
  checkAndResetSlot();
  const currentSlot = getCurrentSlot();
  
  const totalRegionsCount = db.regions.reduce((sum, r) => sum + r.baseCount, 0);
  const userCheckInsCount = db.checkIns.length;
  
  res.json({
    totalProtesters: totalRegionsCount + userCheckInsCount,
    activeRegionsCount: db.regions.filter(r => r.baseCount > 0).length,
    userCheckInsCount: userCheckInsCount,
    lastUpdateTime: new Date(),
    slot: {
      id: currentSlot.id,
      label: currentSlot.label,
      endDate: currentSlot.endDate.toISOString()
    },
    testMode: TEST_MODE
  });
});

// 2. 활성 거점 목록 API
app.get('/api/regions', (req, res) => {
  checkAndResetSlot();
  res.json(db.regions.map(r => {
    const regionCheckins = db.checkIns.filter(c => c.regionId === r.id).length;
    return {
      ...r,
      totalCount: r.baseCount + regionCheckins
    };
  }));
});

// 3. 실시간 피드 메시지 API
app.get('/api/messages', (req, res) => {
  checkAndResetSlot();
  res.json(db.messages.slice(0, 30));
});

// 4. GPS 참여 인증 POST API
app.post('/api/checkin', async (req, res) => {
  checkAndResetSlot();
  const { lat, lng, message } = req.body;
  if (!lat || !lng) {
    return res.status(400).json({ error: "위치 정보(위도, 경도)가 필요합니다." });
  }

  const numLat = parseFloat(lat);
  const numLng = parseFloat(lng);
  
  // 개인정보 보호용 저장 좌표 노이즈 적용 (약 500m ~ 1km 오프셋)
  const latOffset = (Math.random() * 0.012 - 0.006); // -660m ~ +660m
  const lngOffset = (Math.random() * 0.014 - 0.007); // -610m ~ +610m
  const fuzzedLat = numLat + latOffset;
  const fuzzedLng = numLng + lngOffset;

  // 3km 내 거점 탐색
  let nearestRegion = findNearestRegion(numLat, numLng);
  if (!nearestRegion) {
    // 동적 거점 생성 (이미 내부에서 fuzzedLat, fuzzedLng가 계산됨)
    nearestRegion = await createDynamicRegion(numLat, numLng);
  } else {
    // 거점 인원 증가
    nearestRegion.baseCount += 1;
  }

  const checkInId = 'user_' + Date.now();
  const currentSlot = getCurrentSlot();
  
  const checkIn = {
    id: checkInId,
    lat: fuzzedLat,
    lng: fuzzedLng,
    message: message ? message.trim() : '',
    time: new Date(),
    regionId: nearestRegion.id,
    regionName: nearestRegion.name,
    slotId: currentSlot.id
  };

  db.checkIns.unshift(checkIn);

  if (checkIn.message) {
    db.messages.unshift({
      id: checkIn.id,
      regionId: checkIn.regionId,
      regionName: checkIn.regionName,
      message: checkIn.message,
      time: checkIn.time,
      isUser: false, // 피드 동기화를 위한 기본값
      lat: fuzzedLat,
      lng: fuzzedLng
    });
  }

  saveDb();
  
  res.json({
    success: true,
    checkIn: {
      ...checkIn,
      lat: numLat, // 사용자 기기의 로컬 초록색 핀 표시를 위해 원본 좌표 반환
      lng: numLng
    },
    nearestRegion
  });
});

// 정적 파일 제공 미들웨어 (프론트엔드 호스팅)
app.use(express.static(path.join(__dirname)));

// 초기 DB 로드, 시뮬레이터 가동 및 포트 실행
loadDb();
startSimulation();

app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`Server is running at: http://localhost:${PORT}`);
  console.log(`TEST_MODE is ${TEST_MODE ? 'ENABLED (1-Minute Slot reset)' : 'DISABLED (3-Hour Slot reset)'}`);
  console.log(`=========================================`);
});
