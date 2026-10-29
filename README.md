# 의전 체크

행사 의전 담당자가 참석 인사(사진·이름·직위)의 도착을 체크하고, 현황을 사진으로 만들어 카카오톡으로 보내는 안드로이드 앱입니다. 구글 시트를 연결하면 여러 담당자가 같은 현황을 실시간으로 봅니다.

## 폴더 구성

| 경로 | 내용 |
|---|---|
| `web/index.html` | 보드 화면. **보드를 고치면 이 파일만 바꾸면 됩니다** (앱 빌드 때 자동으로 앱 안에 들어감) |
| `app/` | 안드로이드 앱 (보드 실행, 사진 선택·공유·갤러리 저장 연결) |
| `server/Code.gs`, `server/Index.html` | 구글 시트 공유 서버 (Apps Script에 붙여넣기) |
| `docs/privacy.html` | 개인정보처리방침 (GitHub Pages로 공개) |
| `store/` | 플레이스토어 등록용 아이콘(512px)과 그래픽 이미지(1024×500) |
| `.github/workflows/build.yml` | 자동 빌드. `main`에 올리면 설치 파일이 만들어져 **Releases**에 올라감 |

## 빌드 결과 받기

저장소 첫 화면 오른쪽 **Releases** → 최신 버전

- `의전체크_설치용_*.apk` — 휴대폰에 바로 설치
- `의전체크_플레이스토어_*.aab` — Google Play Console에 업로드

## 서명키

플레이스토어용 파일은 저장소 **Settings → Secrets and variables → Actions** 에 저장된 서명키로 서명합니다.
`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` — 서명키 파일(upload.jks)과 비밀번호는 저장소에 올리지 말고 따로 보관하세요.
