// products.js — 꽃안부 상품 단일 소스 (자동 생성물, 직접 수정 금지)
// 생성: scripts/build-products.mjs  |  원장: 3.완성 사진 파일명(이름+가격)  |  짝: products.mjs
// 프론트(catalog.html·index.html)는 products.js, 결제검증 서버(api/confirm-payment.js)는 products.mjs 를 읽는다.
// ⚠️ public 레포이므로 원가·마진 등 내부 정보 필드 금지. 판매가·공개 스펙만.
(function () {
const PRODUCTS = [
 {
  "pc": "BQ-001",
  "cat": "bouquet",
  "sub": "꽃다발",
  "name": "복주머니",
  "subtitle": "용돈꽃다발",
  "price": 58000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b1",
  "photos": [
   "/photos/products/BQ-001_1.jpg",
   "/photos/products/BQ-001_2.jpg",
   "/photos/products/BQ-001_3.jpg"
  ]
 },
 {
  "pc": "BQ-002",
  "cat": "bouquet",
  "sub": "꽃다발",
  "name": "다정",
  "subtitle": "분홍거베라 다발",
  "price": 67000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b2",
  "photos": [
   "/photos/products/BQ-002_1.jpg"
  ]
 },
 {
  "pc": "BQ-003",
  "cat": "bouquet",
  "sub": "꽃다발",
  "name": "웃음꽃",
  "subtitle": "주황장미 다발",
  "price": 67000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b2",
  "photos": [
   "/photos/products/BQ-003_1.jpg",
   "/photos/products/BQ-003_2.jpg",
   "/photos/products/BQ-003_3.jpg"
  ]
 },
 {
  "pc": "BQ-004",
  "cat": "bouquet",
  "sub": "꽃다발",
  "name": "봄마중",
  "subtitle": "분홍튤립 다발",
  "price": 55000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b1",
  "photos": [
   "/photos/products/BQ-004_1.jpg",
   "/photos/products/BQ-004_2.jpg",
   "/photos/products/BQ-004_3.jpg"
  ]
 },
 {
  "pc": "BQ-005",
  "cat": "bouquet",
  "sub": "꽃다발",
  "name": "활짝",
  "subtitle": "보라거베라 다발",
  "price": 58000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b1",
  "photos": [
   "/photos/products/BQ-005_1.jpg",
   "/photos/products/BQ-005_2.jpg",
   "/photos/products/BQ-005_3.jpg"
  ]
 },
 {
  "pc": "BQ-006",
  "cat": "bouquet",
  "sub": "꽃다발",
  "name": "발그레",
  "subtitle": "분홍장미 다발",
  "price": 67000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b2",
  "photos": [
   "/photos/products/BQ-006_1.jpg",
   "/photos/products/BQ-006_2.jpg"
  ]
 },
 {
  "pc": "BQ-007",
  "cat": "bouquet",
  "sub": "꽃다발",
  "name": "온마음",
  "subtitle": "빨간장미 다발",
  "price": 78000,
  "band": "7만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b2",
  "photos": [
   "/photos/products/BQ-007_1.jpg",
   "/photos/products/BQ-007_2.jpg",
   "/photos/products/BQ-007_3.jpg"
  ]
 },
 {
  "pc": "BQ-008",
  "cat": "bouquet",
  "sub": "꽃다발",
  "name": "그리움",
  "subtitle": "보라모둠 다발",
  "price": 78000,
  "band": "7만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b2",
  "photos": [
   "/photos/products/BQ-008_1.jpg",
   "/photos/products/BQ-008_2.jpg",
   "/photos/products/BQ-008_3.jpg"
  ]
 },
 {
  "pc": "BQ-009",
  "cat": "bouquet",
  "sub": "꽃다발",
  "name": "들꽃편지",
  "subtitle": "꽃도라지 다발",
  "price": 68000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b2",
  "photos": [
   "/photos/products/BQ-009_1.jpg",
   "/photos/products/BQ-009_2.jpg",
   "/photos/products/BQ-009_3.jpg"
  ]
 },
 {
  "pc": "BQ-010",
  "cat": "bouquet",
  "sub": "꽃다발",
  "name": "물빛",
  "subtitle": "파란수국 다발",
  "price": 73000,
  "band": "7만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b2",
  "photos": [
   "/photos/products/BQ-010_1.jpg",
   "/photos/products/BQ-010_2.jpg",
   "/photos/products/BQ-010_3.jpg"
  ]
 },
 {
  "pc": "BQ-011",
  "cat": "bouquet",
  "sub": "꽃다발",
  "name": "뭉게구름",
  "subtitle": "수국장미 다발",
  "price": 73000,
  "band": "7만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b2",
  "photos": [
   "/photos/products/BQ-011_1.jpg"
  ]
 },
 {
  "pc": "BQ-012",
  "cat": "bouquet",
  "sub": "꽃다발",
  "name": "봄햇살",
  "subtitle": "주황튤립 다발",
  "price": 73000,
  "band": "7만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b2",
  "photos": [
   "/photos/products/BQ-012_1.jpg",
   "/photos/products/BQ-012_2.jpg",
   "/photos/products/BQ-012_3.jpg"
  ]
 },
 {
  "pc": "BS-001",
  "cat": "basket",
  "sub": "꽃바구니",
  "name": "고마움",
  "subtitle": "빨간장미 바구니",
  "price": 57000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b3",
  "photos": [
   "/photos/products/BS-001_1.jpg",
   "/photos/products/BS-001_2.jpg",
   "/photos/products/BS-001_3.jpg"
  ]
 },
 {
  "pc": "BS-002",
  "cat": "basket",
  "sub": "꽃바구니",
  "name": "노을빛",
  "subtitle": "연분홍작약 바구니",
  "price": 77000,
  "band": "7만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b4",
  "photos": [
   "/photos/products/BS-002_1.jpg",
   "/photos/products/BS-002_2.jpg",
   "/photos/products/BS-002_3.jpg"
  ]
 },
 {
  "pc": "BS-003",
  "cat": "basket",
  "sub": "꽃바구니",
  "name": "봄소풍",
  "subtitle": "봄꽃모둠 바구니",
  "price": 57000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b3",
  "photos": [
   "/photos/products/BS-003_1.jpg",
   "/photos/products/BS-003_2.jpg",
   "/photos/products/BS-003_3.jpg"
  ]
 },
 {
  "pc": "BS-004",
  "cat": "basket",
  "sub": "꽃바구니",
  "name": "복바구니",
  "subtitle": "특대 용돈바구니",
  "price": 147000,
  "band": "10만↑",
  "grade": "스페셜",
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b4",
  "photos": [
   "/photos/products/BS-004_1.jpg",
   "/photos/products/BS-004_2.jpg"
  ]
 },
 {
  "pc": "BS-005",
  "cat": "basket",
  "sub": "꽃바구니",
  "name": "함박웃음",
  "subtitle": "분홍작약 큰바구니",
  "price": 107000,
  "band": "10만↑",
  "grade": "스페셜",
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b4",
  "photos": [
   "/photos/products/BS-005_1.jpg",
   "/photos/products/BS-005_2.jpg",
   "/photos/products/BS-005_3.jpg"
  ]
 },
 {
  "pc": "BS-006",
  "cat": "basket",
  "sub": "꽃바구니",
  "name": "꽃잔치",
  "subtitle": "작약백합 큰바구니",
  "price": 107000,
  "band": "10만↑",
  "grade": "스페셜",
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b4",
  "photos": [
   "/photos/products/BS-006_1.jpg"
  ]
 },
 {
  "pc": "BS-007",
  "cat": "basket",
  "sub": "꽃바구니",
  "name": "솜사탕",
  "subtitle": "보라알리움 바구니",
  "price": 77000,
  "band": "7만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b4",
  "photos": [
   "/photos/products/BS-007_1.jpg",
   "/photos/products/BS-007_2.jpg",
   "/photos/products/BS-007_3.jpg"
  ]
 },
 {
  "pc": "BS-008",
  "cat": "basket",
  "sub": "꽃바구니",
  "name": "햇살가득",
  "subtitle": "해바라기 바구니",
  "price": 77000,
  "band": "7만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b4",
  "photos": [
   "/photos/products/BS-008_1.jpg",
   "/photos/products/BS-008_2.jpg",
   "/photos/products/BS-008_3.jpg"
  ]
 },
 {
  "pc": "BS-009",
  "cat": "basket",
  "sub": "꽃바구니",
  "name": "맑은날",
  "subtitle": "주황장미 바구니",
  "price": 57000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b3",
  "photos": [
   "/photos/products/BS-009_1.jpg",
   "/photos/products/BS-009_2.jpg",
   "/photos/products/BS-009_3.jpg"
  ]
 },
 {
  "pc": "BS-010",
  "cat": "basket",
  "sub": "꽃바구니",
  "name": "꽃대궐",
  "subtitle": "해바라기 특대바구니",
  "price": 147000,
  "band": "10만↑",
  "grade": "스페셜",
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b4",
  "photos": [
   "/photos/products/BS-010_1.jpg",
   "/photos/products/BS-010_2.jpg",
   "/photos/products/BS-010_3.jpg",
   "/photos/products/BS-010_4.jpg"
  ]
 },
 {
  "pc": "BS-011",
  "cat": "basket",
  "sub": "꽃바구니",
  "name": "향기가득",
  "subtitle": "프리지어 큰바구니",
  "price": 107000,
  "band": "10만↑",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b4",
  "photos": [
   "/photos/products/BS-011_1.jpg",
   "/photos/products/BS-011_2.jpg",
   "/photos/products/BS-011_3.jpg"
  ]
 },
 {
  "pc": "BS-012",
  "cat": "basket",
  "sub": "꽃바구니",
  "name": "버들강아지",
  "subtitle": "분홍장미 바구니",
  "price": 67000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b3",
  "photos": [
   "/photos/products/BS-012_1.jpg",
   "/photos/products/BS-012_2.jpg",
   "/photos/products/BS-012_3.jpg"
  ]
 },
 {
  "pc": "BS-013",
  "cat": "basket",
  "sub": "꽃바구니",
  "name": "연지곤지",
  "subtitle": "카네이션 바구니",
  "price": 67000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b3",
  "photos": [
   "/photos/products/BS-013_1.jpg",
   "/photos/products/BS-013_2.jpg"
  ]
 },
 {
  "pc": "BS-014",
  "cat": "basket",
  "sub": "꽃바구니",
  "name": "꽃단장",
  "subtitle": "카네이션백합 바구니",
  "price": 67000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b3",
  "photos": [
   "/photos/products/BS-014_1.jpg",
   "/photos/products/BS-014_2.jpg"
  ]
 },
 {
  "pc": "BS-015",
  "cat": "basket",
  "sub": "꽃바구니",
  "name": "도란도란",
  "subtitle": "홍백장미 바구니",
  "price": 77000,
  "band": "7만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "basket_b4",
  "photos": [
   "/photos/products/BS-015_1.jpg",
   "/photos/products/BS-015_2.jpg",
   "/photos/products/BS-015_3.jpg"
  ]
 },
 {
  "pc": "OR-001",
  "cat": "orchid",
  "sub": "동양란",
  "name": "대국",
  "subtitle": null,
  "price": 128000,
  "band": "10만↑",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o2",
  "photos": [
   "/photos/products/OR-001_1.jpg",
   "/photos/products/OR-001_2.jpg"
  ]
 },
 {
  "pc": "OR-002",
  "cat": "orchid",
  "sub": "동양란",
  "name": "대국",
  "subtitle": null,
  "price": 147000,
  "band": "10만↑",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o2",
  "photos": [
   "/photos/products/OR-002_1.jpg",
   "/photos/products/OR-002_2.jpg"
  ]
 },
 {
  "pc": "OR-003",
  "cat": "orchid",
  "sub": "동양란",
  "name": "철골소심",
  "subtitle": null,
  "price": 63000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o1",
  "photos": [
   "/photos/products/OR-003_1.jpg",
   "/photos/products/OR-003_2.jpg",
   "/photos/products/OR-003_3.jpg"
  ]
 },
 {
  "pc": "OR-004",
  "cat": "orchid",
  "sub": "동양란",
  "name": "태양금",
  "subtitle": null,
  "price": 128000,
  "band": "10만↑",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o2",
  "photos": [
   "/photos/products/OR-004_1.jpg",
   "/photos/products/OR-004_2.jpg",
   "/photos/products/OR-004_3.jpg"
  ]
 },
 {
  "pc": "OR-005",
  "cat": "orchid",
  "sub": "동양란",
  "name": "황룡금",
  "subtitle": null,
  "price": 117000,
  "band": "10만↑",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o2",
  "photos": [
   "/photos/products/OR-005_1.jpg",
   "/photos/products/OR-005_2.jpg",
   "/photos/products/OR-005_3.jpg"
  ]
 },
 {
  "pc": "OR-006",
  "cat": "orchid",
  "sub": "동양란",
  "name": "황룡금",
  "subtitle": null,
  "price": 108000,
  "band": "10만↑",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o2",
  "photos": [
   "/photos/products/OR-006_1.jpg",
   "/photos/products/OR-006_2.jpg",
   "/photos/products/OR-006_3.jpg"
  ]
 },
 {
  "pc": "OR-007",
  "cat": "orchid",
  "sub": "동양란",
  "name": "황룡금",
  "subtitle": null,
  "price": 98000,
  "band": "9만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o2",
  "photos": [
   "/photos/products/OR-007_1.jpg",
   "/photos/products/OR-007_2.jpg"
  ]
 },
 {
  "pc": "OR-008",
  "cat": "orchid",
  "sub": "서양란",
  "name": "호접란",
  "subtitle": null,
  "price": 67000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o3",
  "photos": [
   "/photos/products/OR-008_1.jpg"
  ]
 },
 {
  "pc": "OR-009",
  "cat": "orchid",
  "sub": "서양란",
  "name": "호접란",
  "subtitle": null,
  "price": 78000,
  "band": "7만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o3",
  "photos": [
   "/photos/products/OR-009_1.jpg"
  ]
 },
 {
  "pc": "OR-010",
  "cat": "orchid",
  "sub": "서양란",
  "name": "호접란",
  "subtitle": null,
  "price": 78000,
  "band": "7만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o3",
  "photos": [
   "/photos/products/OR-010_1.jpg"
  ]
 },
 {
  "pc": "OR-011",
  "cat": "orchid",
  "sub": "서양란",
  "name": "호접란",
  "subtitle": null,
  "price": 128000,
  "band": "10만↑",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o4",
  "photos": [
   "/photos/products/OR-011_1.jpg"
  ]
 },
 {
  "pc": "OR-012",
  "cat": "orchid",
  "sub": "서양란",
  "name": "호접란",
  "subtitle": null,
  "price": 150000,
  "band": "10만↑",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o4",
  "photos": [
   "/photos/products/OR-012_1.jpg"
  ]
 },
 {
  "pc": "OR-013",
  "cat": "orchid",
  "sub": "서양란",
  "name": "호접란",
  "subtitle": null,
  "price": 197000,
  "band": "10만↑",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o4",
  "photos": [
   "/photos/products/OR-013_1.jpg"
  ]
 },
 {
  "pc": "OR-014",
  "cat": "orchid",
  "sub": "서양란",
  "name": "호접란",
  "subtitle": null,
  "price": 128000,
  "band": "10만↑",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o4",
  "photos": [
   "/photos/products/OR-014_1.jpg"
  ]
 },
 {
  "pc": "OR-015",
  "cat": "orchid",
  "sub": "서양란",
  "name": "호접란",
  "subtitle": null,
  "price": 78000,
  "band": "7만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o3",
  "photos": [
   "/photos/products/OR-015_1.jpg"
  ]
 },
 {
  "pc": "OR-016",
  "cat": "orchid",
  "sub": "서양란",
  "name": "호접란",
  "subtitle": null,
  "price": 78000,
  "band": "7만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o3",
  "photos": [
   "/photos/products/OR-016_1.jpg"
  ]
 },
 {
  "pc": "OR-017",
  "cat": "orchid",
  "sub": "서양란",
  "name": "호접란",
  "subtitle": null,
  "price": 128000,
  "band": "10만↑",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o4",
  "photos": [
   "/photos/products/OR-017_1.jpg"
  ]
 },
 {
  "pc": "OR-018",
  "cat": "orchid",
  "sub": "서양란",
  "name": "호접란",
  "subtitle": null,
  "price": 128000,
  "band": "10만↑",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o4",
  "photos": [
   "/photos/products/OR-018_1.jpg"
  ]
 },
 {
  "pc": "OR-019",
  "cat": "orchid",
  "sub": "서양란",
  "name": "호접란",
  "subtitle": null,
  "price": 67000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "orchid_o3",
  "photos": [
   "/photos/products/OR-019_1.jpg"
  ]
 },
 {
  "pc": "PL-001",
  "cat": "plant",
  "sub": "관엽",
  "name": "가지마루",
  "subtitle": null,
  "price": 147000,
  "band": "10만↑",
  "grade": null,
  "size": {
   "h": 900,
   "w": 400
  },
  "status": "판매중",
  "legacyTier": "plant_p4",
  "photos": [
   "/photos/products/PL-001_1.jpg",
   "/photos/products/PL-001_2.jpg",
   "/photos/products/PL-001_3.jpg"
  ]
 },
 {
  "pc": "PL-002",
  "cat": "plant",
  "sub": "관엽",
  "name": "가지마루",
  "subtitle": null,
  "price": 128000,
  "band": "10만↑",
  "grade": null,
  "size": {
   "h": 900,
   "w": 400
  },
  "status": "판매중",
  "legacyTier": "plant_p4",
  "photos": [
   "/photos/products/PL-002_1.jpg"
  ]
 },
 {
  "pc": "PL-003",
  "cat": "plant",
  "sub": "관엽",
  "name": "금전수",
  "subtitle": null,
  "price": 67000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "plant_p1",
  "photos": [
   "/photos/products/PL-003_1.jpg"
  ]
 },
 {
  "pc": "PL-004",
  "cat": "plant",
  "sub": "관엽",
  "name": "금전수",
  "subtitle": null,
  "price": 98000,
  "band": "9만대",
  "grade": null,
  "size": {
   "h": 1200,
   "w": 600
  },
  "status": "판매중",
  "legacyTier": "plant_p3",
  "photos": [
   "/photos/products/PL-004_1.jpg"
  ]
 },
 {
  "pc": "PL-005",
  "cat": "plant",
  "sub": "관엽",
  "name": "금전수",
  "subtitle": null,
  "price": 98000,
  "band": "9만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "plant_p3",
  "photos": [
   "/photos/products/PL-005_1.jpg",
   "/photos/products/PL-005_2.jpg"
  ]
 },
 {
  "pc": "PL-006",
  "cat": "plant",
  "sub": "관엽",
  "name": "금전수",
  "subtitle": null,
  "price": 118000,
  "band": "10만↑",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "plant_p4",
  "photos": [
   "/photos/products/PL-006_1.jpg"
  ]
 },
 {
  "pc": "PL-007",
  "cat": "plant",
  "sub": "관엽",
  "name": "금전수",
  "subtitle": null,
  "price": 77000,
  "band": "7만대",
  "grade": null,
  "size": {
   "h": 1000,
   "w": 500
  },
  "status": "판매중",
  "legacyTier": "plant_p2",
  "photos": [
   "/photos/products/PL-007_1.jpg"
  ]
 },
 {
  "pc": "PL-008",
  "cat": "plant",
  "sub": "관엽",
  "name": "녹보수",
  "subtitle": null,
  "price": 247000,
  "band": "10만↑",
  "grade": "3지 특자",
  "size": {
   "h": 1500,
   "w": 700
  },
  "status": "판매중",
  "legacyTier": "plant_p4",
  "photos": [
   "/photos/products/PL-008_1.jpg"
  ]
 },
 {
  "pc": "PL-009",
  "cat": "plant",
  "sub": "관엽",
  "name": "녹보수",
  "subtitle": null,
  "price": 63000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "plant_p1",
  "photos": [
   "/photos/products/PL-009_1.jpg"
  ]
 },
 {
  "pc": "PL-010",
  "cat": "plant",
  "sub": "관엽",
  "name": "녹보수",
  "subtitle": null,
  "price": 98000,
  "band": "9만대",
  "grade": null,
  "size": {
   "h": 1500,
   "w": 550
  },
  "status": "판매중",
  "legacyTier": "plant_p3",
  "photos": [
   "/photos/products/PL-010_1.jpg",
   "/photos/products/PL-010_2.jpg"
  ]
 },
 {
  "pc": "PL-011",
  "cat": "plant",
  "sub": "관엽",
  "name": "녹보수",
  "subtitle": null,
  "price": 108000,
  "band": "10만↑",
  "grade": null,
  "size": {
   "h": 1500,
   "w": 600
  },
  "status": "판매중",
  "legacyTier": "plant_p3",
  "photos": [
   "/photos/products/PL-011_1.jpg",
   "/photos/products/PL-011_2.jpg"
  ]
 },
 {
  "pc": "PL-012",
  "cat": "plant",
  "sub": "관엽",
  "name": "드라세나마지나타",
  "subtitle": null,
  "price": 110000,
  "band": "10만↑",
  "grade": null,
  "size": {
   "h": 1500,
   "w": 700
  },
  "status": "판매중",
  "legacyTier": "plant_p3",
  "photos": [
   "/photos/products/PL-012_1.jpg",
   "/photos/products/PL-012_2.jpg"
  ]
 },
 {
  "pc": "PL-013",
  "cat": "plant",
  "sub": "관엽",
  "name": "드라코",
  "subtitle": null,
  "price": 99000,
  "band": "9만대",
  "grade": null,
  "size": {
   "h": 1400,
   "w": 600
  },
  "status": "판매중",
  "legacyTier": "plant_p3",
  "photos": [
   "/photos/products/PL-013_1.jpg",
   "/photos/products/PL-013_2.jpg"
  ]
 },
 {
  "pc": "PL-014",
  "cat": "plant",
  "sub": "관엽",
  "name": "떡갈나무",
  "subtitle": null,
  "price": 157000,
  "band": "10만↑",
  "grade": null,
  "size": {
   "h": 1500,
   "w": 700
  },
  "status": "판매중",
  "legacyTier": "plant_p4",
  "photos": [
   "/photos/products/PL-014_1.jpg",
   "/photos/products/PL-014_2.jpg"
  ]
 },
 {
  "pc": "PL-015",
  "cat": "plant",
  "sub": "관엽",
  "name": "몬스테라",
  "subtitle": null,
  "price": 66000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "plant_p1",
  "photos": [
   "/photos/products/PL-015_1.jpg"
  ]
 },
 {
  "pc": "PL-016",
  "cat": "plant",
  "sub": "관엽",
  "name": "뱅갈고무나무",
  "subtitle": null,
  "price": 119000,
  "band": "10만↑",
  "grade": null,
  "size": {
   "h": 1500,
   "w": 700
  },
  "status": "판매중",
  "legacyTier": "plant_p4",
  "photos": [
   "/photos/products/PL-016_1.jpg",
   "/photos/products/PL-016_2.jpg"
  ]
 },
 {
  "pc": "PL-017",
  "cat": "plant",
  "sub": "관엽",
  "name": "뱅갈고무나무",
  "subtitle": null,
  "price": 98000,
  "band": "9만대",
  "grade": null,
  "size": {
   "h": 1400,
   "w": 700
  },
  "status": "판매중",
  "legacyTier": "plant_p3",
  "photos": [
   "/photos/products/PL-017_1.jpg",
   "/photos/products/PL-017_2.jpg"
  ]
 },
 {
  "pc": "PL-018",
  "cat": "plant",
  "sub": "관엽",
  "name": "스투키",
  "subtitle": null,
  "price": 98000,
  "band": "9만대",
  "grade": null,
  "size": {
   "h": 1100,
   "w": 600
  },
  "status": "판매중",
  "legacyTier": "plant_p3",
  "photos": [
   "/photos/products/PL-018_1.jpg",
   "/photos/products/PL-018_2.jpg"
  ]
 },
 {
  "pc": "PL-019",
  "cat": "plant",
  "sub": "관엽",
  "name": "스투키",
  "subtitle": null,
  "price": 68000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "plant_p1",
  "photos": [
   "/photos/products/PL-019_1.jpg"
  ]
 },
 {
  "pc": "PL-020",
  "cat": "plant",
  "sub": "관엽",
  "name": "스투키",
  "subtitle": null,
  "price": 99000,
  "band": "9만대",
  "grade": null,
  "size": {
   "h": 1100,
   "w": 500
  },
  "status": "판매중",
  "legacyTier": "plant_p3",
  "photos": [
   "/photos/products/PL-020_1.jpg",
   "/photos/products/PL-020_2.jpg"
  ]
 },
 {
  "pc": "PL-022",
  "cat": "plant",
  "sub": "관엽",
  "name": "아레카야자",
  "subtitle": null,
  "price": 119000,
  "band": "10만↑",
  "grade": null,
  "size": {
   "h": 1500,
   "w": 700
  },
  "status": "판매중",
  "legacyTier": "plant_p4",
  "photos": [
   "/photos/products/PL-022_1.jpg",
   "/photos/products/PL-022_2.jpg"
  ]
 },
 {
  "pc": "PL-023",
  "cat": "plant",
  "sub": "관엽",
  "name": "아레카야자",
  "subtitle": null,
  "price": 128000,
  "band": "10만↑",
  "grade": null,
  "size": {
   "h": 1500,
   "w": 700
  },
  "status": "판매중",
  "legacyTier": "plant_p4",
  "photos": [
   "/photos/products/PL-023_1.jpg",
   "/photos/products/PL-023_2.jpg"
  ]
 },
 {
  "pc": "PL-024",
  "cat": "plant",
  "sub": "관엽",
  "name": "안시디움",
  "subtitle": null,
  "price": 63000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "plant_p1",
  "photos": [
   "/photos/products/PL-024_1.jpg"
  ]
 },
 {
  "pc": "PL-025",
  "cat": "plant",
  "sub": "관엽",
  "name": "알로카시아",
  "subtitle": null,
  "price": 98000,
  "band": "9만대",
  "grade": null,
  "size": {
   "h": 1500,
   "w": 700
  },
  "status": "판매중",
  "legacyTier": "plant_p3",
  "photos": [
   "/photos/products/PL-025_1.jpg",
   "/photos/products/PL-025_2.jpg"
  ]
 },
 {
  "pc": "PL-026",
  "cat": "plant",
  "sub": "관엽",
  "name": "여인초",
  "subtitle": null,
  "price": 119000,
  "band": "10만↑",
  "grade": null,
  "size": {
   "h": 1500,
   "w": 700
  },
  "status": "판매중",
  "legacyTier": "plant_p4",
  "photos": [
   "/photos/products/PL-026_1.jpg",
   "/photos/products/PL-026_2.jpg"
  ]
 },
 {
  "pc": "PL-027",
  "cat": "plant",
  "sub": "관엽",
  "name": "여인초",
  "subtitle": null,
  "price": 108000,
  "band": "10만↑",
  "grade": null,
  "size": {
   "h": 1500,
   "w": 700
  },
  "status": "판매중",
  "legacyTier": "plant_p3",
  "photos": [
   "/photos/products/PL-027_1.jpg",
   "/photos/products/PL-027_2.jpg"
  ]
 },
 {
  "pc": "PL-028",
  "cat": "plant",
  "sub": "관엽",
  "name": "율마",
  "subtitle": null,
  "price": 63000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "plant_p1",
  "photos": [
   "/photos/products/PL-028_1.jpg",
   "/photos/products/PL-028_2.jpg"
  ]
 },
 {
  "pc": "PL-029",
  "cat": "plant",
  "sub": "관엽",
  "name": "인도고무나무",
  "subtitle": null,
  "price": 57000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "plant_p1",
  "photos": [
   "/photos/products/PL-029_1.jpg"
  ]
 },
 {
  "pc": "PL-030",
  "cat": "plant",
  "sub": "관엽",
  "name": "인도고무나무",
  "subtitle": null,
  "price": 98000,
  "band": "9만대",
  "grade": null,
  "size": {
   "h": 1400,
   "w": 600
  },
  "status": "판매중",
  "legacyTier": "plant_p3",
  "photos": [
   "/photos/products/PL-030_1.jpg",
   "/photos/products/PL-030_2.jpg"
  ]
 },
 {
  "pc": "PL-031",
  "cat": "plant",
  "sub": "관엽",
  "name": "인도고무나무",
  "subtitle": null,
  "price": 108000,
  "band": "10만↑",
  "grade": null,
  "size": {
   "h": 1500,
   "w": 700
  },
  "status": "판매중",
  "legacyTier": "plant_p3",
  "photos": [
   "/photos/products/PL-031_1.jpg",
   "/photos/products/PL-031_2.jpg"
  ]
 },
 {
  "pc": "PL-032",
  "cat": "plant",
  "sub": "관엽",
  "name": "인삼벤자민",
  "subtitle": null,
  "price": 66000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "plant_p1",
  "photos": [
   "/photos/products/PL-032_1.jpg"
  ]
 },
 {
  "pc": "PL-034",
  "cat": "plant",
  "sub": "관엽",
  "name": "자바",
  "subtitle": null,
  "price": 118000,
  "band": "10만↑",
  "grade": null,
  "size": {
   "h": 1800,
   "w": 700
  },
  "status": "판매중",
  "legacyTier": "plant_p4",
  "photos": [
   "/photos/products/PL-034_1.jpg",
   "/photos/products/PL-034_2.jpg"
  ]
 },
 {
  "pc": "PL-035",
  "cat": "plant",
  "sub": "관엽",
  "name": "초록몬스테라",
  "subtitle": null,
  "price": 63000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "plant_p1",
  "photos": [
   "/photos/products/PL-035_1.jpg"
  ]
 },
 {
  "pc": "PL-036",
  "cat": "plant",
  "sub": "관엽",
  "name": "칼라벤자민",
  "subtitle": null,
  "price": 157000,
  "band": "10만↑",
  "grade": "특",
  "size": {
   "h": 1500,
   "w": 700
  },
  "status": "판매중",
  "legacyTier": "plant_p4",
  "photos": [
   "/photos/products/PL-036_1.jpg",
   "/photos/products/PL-036_2.jpg"
  ]
 },
 {
  "pc": "PL-037",
  "cat": "plant",
  "sub": "관엽",
  "name": "크로톤",
  "subtitle": null,
  "price": 98000,
  "band": "9만대",
  "grade": null,
  "size": {
   "h": 900,
   "w": 600
  },
  "status": "판매중",
  "legacyTier": "plant_p3",
  "photos": [
   "/photos/products/PL-037_1.jpg",
   "/photos/products/PL-037_2.jpg"
  ]
 },
 {
  "pc": "PL-038",
  "cat": "plant",
  "sub": "관엽",
  "name": "크로톤",
  "subtitle": null,
  "price": 128000,
  "band": "10만↑",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "plant_p4",
  "photos": [
   "/photos/products/PL-038_1.jpg"
  ]
 },
 {
  "pc": "PL-039",
  "cat": "plant",
  "sub": "관엽",
  "name": "킹벤자민",
  "subtitle": null,
  "price": 98000,
  "band": "9만대",
  "grade": null,
  "size": {
   "h": 1200,
   "w": 700
  },
  "status": "판매중",
  "legacyTier": "plant_p3",
  "photos": [
   "/photos/products/PL-039_1.jpg"
  ]
 },
 {
  "pc": "PL-040",
  "cat": "plant",
  "sub": "관엽",
  "name": "파키라",
  "subtitle": null,
  "price": 118000,
  "band": "10만↑",
  "grade": null,
  "size": {
   "h": 1500,
   "w": 700
  },
  "status": "판매중",
  "legacyTier": "plant_p4",
  "photos": [
   "/photos/products/PL-040_1.jpg",
   "/photos/products/PL-040_2.jpg"
  ]
 },
 {
  "pc": "PL-041",
  "cat": "plant",
  "sub": "관엽",
  "name": "파키라특",
  "subtitle": null,
  "price": 138000,
  "band": "10만↑",
  "grade": null,
  "size": {
   "h": 1600,
   "w": 700
  },
  "status": "판매중",
  "legacyTier": "plant_p4",
  "photos": [
   "/photos/products/PL-041_1.jpg",
   "/photos/products/PL-041_2.jpg"
  ]
 },
 {
  "pc": "PL-042",
  "cat": "plant",
  "sub": "관엽",
  "name": "해피트리",
  "subtitle": null,
  "price": 168000,
  "band": "10만↑",
  "grade": null,
  "size": {
   "h": 1600,
   "w": 800
  },
  "status": "판매중",
  "legacyTier": "plant_p4",
  "photos": [
   "/photos/products/PL-042_1.jpg",
   "/photos/products/PL-042_2.jpg"
  ]
 },
 {
  "pc": "PL-043",
  "cat": "plant",
  "sub": "관엽",
  "name": "행운목",
  "subtitle": null,
  "price": 118000,
  "band": "10만↑",
  "grade": null,
  "size": {
   "h": 1500,
   "w": 500
  },
  "status": "판매중",
  "legacyTier": "plant_p4",
  "photos": [
   "/photos/products/PL-043_1.jpg"
  ]
 },
 {
  "pc": "PL-044",
  "cat": "plant",
  "sub": "관엽",
  "name": "행운목",
  "subtitle": null,
  "price": 76000,
  "band": "7만대",
  "grade": null,
  "size": {
   "h": 1100,
   "w": 500
  },
  "status": "판매중",
  "legacyTier": "plant_p2",
  "photos": [
   "/photos/products/PL-044_1.jpg"
  ]
 },
 {
  "pc": "PL-045",
  "cat": "plant",
  "sub": "관엽",
  "name": "행운목괴목",
  "subtitle": null,
  "price": 88000,
  "band": "7만대",
  "grade": null,
  "size": {
   "h": 1100,
   "w": 600
  },
  "status": "판매중",
  "legacyTier": "plant_p2",
  "photos": [
   "/photos/products/PL-045_1.jpg"
  ]
 },
 {
  "pc": "PL-046",
  "cat": "plant",
  "sub": "관엽",
  "name": "홍콩야자",
  "subtitle": null,
  "price": 63000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "plant_p1",
  "photos": [
   "/photos/products/PL-046_1.jpg"
  ]
 },
 {
  "pc": "PL-047",
  "cat": "plant",
  "sub": "관엽",
  "name": "황금죽",
  "subtitle": null,
  "price": 83000,
  "band": "7만대",
  "grade": null,
  "size": {
   "h": 1000,
   "w": 500
  },
  "status": "판매중",
  "legacyTier": "plant_p2",
  "photos": [
   "/photos/products/PL-047_1.jpg"
  ]
 },
 {
  "pc": "PL-048",
  "cat": "plant",
  "sub": "관엽",
  "name": "황금죽",
  "subtitle": null,
  "price": 108000,
  "band": "10만↑",
  "grade": null,
  "size": {
   "h": 1500,
   "w": 500
  },
  "status": "판매중",
  "legacyTier": "plant_p3",
  "photos": [
   "/photos/products/PL-048_1.jpg"
  ]
 },
 {
  "pc": "PL-049",
  "cat": "plant",
  "sub": "관엽",
  "name": "황금죽",
  "subtitle": null,
  "price": 63000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "plant_p1",
  "photos": [
   "/photos/products/PL-049_1.jpg"
  ]
 },
 {
  "pc": "PL-050",
  "cat": "plant",
  "sub": "관엽",
  "name": "스파티필룸",
  "subtitle": null,
  "price": 63000,
  "band": "5만대",
  "grade": null,
  "size": null,
  "status": "판매중",
  "legacyTier": "plant_p1",
  "photos": [
   "/photos/products/PL-050_1.jpg"
  ]
 },
 {
  "pc": "PL-051",
  "cat": "plant",
  "sub": "관엽",
  "name": "자마이카",
  "subtitle": null,
  "price": 68000,
  "band": "5만대",
  "grade": null,
  "size": {
   "h": 1100,
   "w": 600
  },
  "status": "판매중",
  "legacyTier": "plant_p1",
  "photos": [
   "/photos/products/PL-051_1.jpg",
   "/photos/products/PL-051_2.jpg"
  ]
 },
 {
  "pc": "WC-01",
  "cat": "condolence",
  "sub": "근조",
  "name": "근조 보통",
  "subtitle": null,
  "price": 59000,
  "band": "5만대",
  "grade": "보통",
  "size": null,
  "status": "판매중",
  "legacyTier": "condolence_c1",
  "photos": [
   "/photos/products/WC-01_1.jpg"
  ]
 },
 {
  "pc": "WC-02",
  "cat": "condolence",
  "sub": "근조",
  "name": "근조 스페셜",
  "subtitle": null,
  "price": 119000,
  "band": "10만↑",
  "grade": "스페셜",
  "size": null,
  "status": "판매중",
  "legacyTier": "condolence_c4",
  "photos": [
   "/photos/products/WC-02_1.jpg"
  ]
 },
 {
  "pc": "WC-03",
  "cat": "condolence",
  "sub": "근조",
  "name": "근조 오브제",
  "subtitle": null,
  "price": 70000,
  "band": "7만대",
  "grade": "오브제",
  "size": null,
  "status": "판매중",
  "legacyTier": "condolence_c2",
  "photos": [
   "/photos/products/WC-03_1.jpg"
  ]
 },
 {
  "pc": "WC-04",
  "cat": "condolence",
  "sub": "근조",
  "name": "근조 일반1호",
  "subtitle": null,
  "price": 79000,
  "band": "7만대",
  "grade": "일반1호",
  "size": null,
  "status": "판매중",
  "legacyTier": "condolence_c2",
  "photos": [
   "/photos/products/WC-04_1.jpg"
  ]
 },
 {
  "pc": "WC-05",
  "cat": "condolence",
  "sub": "근조",
  "name": "근조 일반2호",
  "subtitle": null,
  "price": 99000,
  "band": "9만대",
  "grade": "일반2호",
  "size": null,
  "status": "판매중",
  "legacyTier": "condolence_c3",
  "photos": [
   "/photos/products/WC-05_1.jpg"
  ]
 },
 {
  "pc": "WC-06",
  "cat": "condolence",
  "sub": "근조",
  "name": "근조 특대",
  "subtitle": null,
  "price": 149000,
  "band": "10만↑",
  "grade": "특대",
  "size": null,
  "status": "판매중",
  "legacyTier": "condolence_c4",
  "photos": [
   "/photos/products/WC-06_1.jpg"
  ]
 },
 {
  "pc": "WG-01",
  "cat": "congrats",
  "sub": "축하",
  "name": "축하 보통",
  "subtitle": null,
  "price": 59000,
  "band": "5만대",
  "grade": "보통",
  "size": null,
  "status": "판매중",
  "legacyTier": "congrats_g1",
  "photos": [
   "/photos/products/WG-01_1.jpg"
  ]
 },
 {
  "pc": "WG-02",
  "cat": "congrats",
  "sub": "축하",
  "name": "축하 스페셜1호",
  "subtitle": null,
  "price": 99000,
  "band": "9만대",
  "grade": "스페셜1호",
  "size": null,
  "status": "판매중",
  "legacyTier": "congrats_g3",
  "photos": [
   "/photos/products/WG-02_1.jpg"
  ]
 },
 {
  "pc": "WG-03",
  "cat": "congrats",
  "sub": "축하",
  "name": "축하 일반",
  "subtitle": null,
  "price": 79000,
  "band": "7만대",
  "grade": "일반",
  "size": null,
  "status": "판매중",
  "legacyTier": "congrats_g2",
  "photos": [
   "/photos/products/WG-03_1.jpg"
  ]
 },
 {
  "pc": "WG-04",
  "cat": "congrats",
  "sub": "축하",
  "name": "축하 특상",
  "subtitle": null,
  "price": 149000,
  "band": "10만↑",
  "grade": "특상",
  "size": null,
  "status": "판매중",
  "legacyTier": "congrats_g4",
  "photos": [
   "/photos/products/WG-04_1.jpg"
  ]
 },
 {
  "pc": "WG-05",
  "cat": "congrats",
  "sub": "축하",
  "name": "축하 특일반",
  "subtitle": null,
  "price": 119000,
  "band": "10만↑",
  "grade": "특일반",
  "size": null,
  "status": "판매중",
  "legacyTier": "congrats_g4",
  "photos": [
   "/photos/products/WG-05_1.jpg"
  ]
 }
];

const LEGACY_TIERS = {
 "congrats_g1": 59000,
 "congrats_g2": 79000,
 "congrats_g3": 99000,
 "congrats_g4": 129000,
 "condolence_c1": 59000,
 "condolence_c2": 79000,
 "condolence_c3": 99000,
 "condolence_c4": 129000,
 "orchid_o1": 69000,
 "orchid_o2": 99000,
 "orchid_o3": 79000,
 "orchid_o4": 119000,
 "plant_p1": 59000,
 "plant_p2": 79000,
 "plant_p3": 99000,
 "plant_p4": 129000,
 "basket_b1": 49000,
 "basket_b2": 69000,
 "basket_b3": 59000,
 "basket_b4": 89000
};

const TOPPINGS = {
 "top_rice": {
  "nm": "쌀 10kg 얹기",
  "price": 20000,
  "d": "행사 후 상주·혼주께 전달되는 쌀화환 구성"
 },
 "top_ribbon": {
  "nm": "금박 고급 리본",
  "price": 10000,
  "d": "리본 문구를 금박으로 더 격식 있게"
 },
 "top_pot": {
  "nm": "도자기 분 업그레이드",
  "price": 20000,
  "d": "기본 분 대신 도자기 화분으로"
 },
 "top_plaque": {
  "nm": "나무 명패",
  "price": 10000,
  "d": "보내는 분 명패 제작 (법인 인기)"
 },
 "top_wheel": {
  "nm": "바퀴 화분받침",
  "price": 15000,
  "d": "이동이 편한 바퀴형 받침 — 실내 배치·청소 편리"
 },
 "top_lush_p1": {
  "nm": "조금 더 크게",
  "price": 20000,
  "d": "한 단계 큰 수형으로",
  "grp": "lush"
 },
 "top_lush_p2": {
  "nm": "훨씬 크게",
  "price": 30000,
  "d": "두 단계 큰 수형으로 가장 풍성하게",
  "grp": "lush"
 },
 "top_lush_b1": {
  "nm": "조금 더 풍성하게",
  "price": 10000,
  "d": "꽃 물량을 한 단계 늘립니다",
  "grp": "lush"
 },
 "top_lush_b2": {
  "nm": "많이 풍성하게",
  "price": 20000,
  "d": "꽃 물량을 두 단계 늘립니다",
  "grp": "lush"
 },
 "top_more": {
  "nm": "더 풍성하게",
  "price": 20000,
  "d": "꽃 물량을 한 단계 늘립니다"
 },
 "top_wine": {
  "nm": "와인 동봉",
  "price": 30000,
  "d": "축하 와인 한 병을 함께"
 },
 "top_card": {
  "nm": "손글씨 카드",
  "price": 5000,
  "d": "메시지를 카드에 정성껏 적어 동봉"
 }
};

const TOPPINGS_BY_CAT = {
 "congrats": [
  "top_rice",
  "top_ribbon"
 ],
 "condolence": [
  "top_rice",
  "top_ribbon"
 ],
 "orchid": [
  "top_pot",
  "top_plaque",
  "top_ribbon"
 ],
 "plant": [
  "top_lush_p1",
  "top_lush_p2",
  "top_wheel",
  "top_plaque"
 ],
 "bouquet": [
  "top_lush_b1",
  "top_lush_b2",
  "top_wine",
  "top_card"
 ],
 "basket": [
  "top_lush_b1",
  "top_lush_b2",
  "top_wine",
  "top_card"
 ]
};

// 상품코드(신규 pc 또는 구 티어코드) → 정가. 결제 금액검증의 단일 기준.
function priceOf(code){
  const p = PRODUCTS.find((x) => x.pc === code);
  if (p) return p.price;
  if (code in LEGACY_TIERS) return LEGACY_TIERS[code];
  return null;
}

const AF_PRODUCTS = { PRODUCTS, LEGACY_TIERS, TOPPINGS, TOPPINGS_BY_CAT, priceOf };
  if (typeof window !== "undefined") { Object.assign(window, AF_PRODUCTS); window.AF_PRODUCTS = AF_PRODUCTS; }
})();
