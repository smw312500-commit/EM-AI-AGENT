# Flask YouTube Person Detector

Flask 웹앱에서 유튜브 영상 URL을 받아 사람을 감지하고, 브라우저에 감지 박스와 인원 수를 보여주는 예제입니다.

## 주요 기능

- YouTube URL 또는 직접 재생 가능한 영상 URL 입력
- OpenCV HOG 기반 사람 감지
- 브라우저에서 MJPEG 스트림으로 결과 확인
- 현재 상태, 사람 수, 처리 프레임, 해상도 표시

## 실행 방법

```bash
cd person_detection_flask
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

브라우저에서 `http://127.0.0.1:5000` 을 열면 됩니다.

## 참고

- YouTube 링크를 처리하려면 `yt-dlp`가 필요합니다.
- 사람 감지는 OpenCV HOG 방식이라서 YOLO 계열보다 정확도가 낮을 수 있습니다.
- 더 높은 정확도가 필요하면 `ultralytics` 기반 YOLO 모델로 바꾸는 확장도 가능합니다.
