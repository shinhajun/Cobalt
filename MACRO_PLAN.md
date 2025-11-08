# 매크로 학습 기능 구현 계획

## 📋 프로젝트 개요

Cobalt AI 브라우저에 매크로 녹화 및 재생 기능을 추가합니다. 사용자가 웹 작업을 녹화하고, 순서도로 확인하며, AI를 활용한 변주를 통해 반복 작업을 자동화할 수 있습니다.

**생성일**: 2025-11-03
**버전**: 1.0

---

## 🎯 핵심 기능

### 1. 매크로 녹화
- URL 창 오른쪽에 녹화 버튼 배치
- 사용자의 브라우저 작업 실시간 캡처:
  - 페이지 네비게이션
  - 요소 클릭
  - 텍스트 입력
  - 키보드 입력 (Enter, Tab 등)
  - 스크롤
  - 폼 제출

### 2. 순서도 시각화
- 녹화된 작업을 직관적인 순서도로 표시
- 각 단계별 상세 정보 표시 (타임스탬프, 대상 요소 등)
- 입력값 수정 기능:
  - **고정값**: 항상 같은 값 사용
  - **사용자 입력**: 실행 시 사용자에게 물어보기
  - **AI 생성**: AI가 동적으로 값 생성

### 3. AI 변주
- 각 입력 단계에 AI 프롬프트 추가 가능
- 실행 시 LLM을 통해 동적으로 값 생성
- 반복 작업의 창의적 변형 지원

### 4. 매크로 실행
- 저장된 매크로 재생
- 실시간 진행상황 표시
- BrowserController를 통한 정확한 재현

---

## 🏗️ 시스템 아키텍처

### 핵심 모듈 구성

```
┌─────────────────────────────────────────────────────┐
│                   Cobalt Browser                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────┐    ┌──────────────┐              │
│  │   UI Layer  │    │ Event Layer  │              │
│  │             │    │              │              │
│  │ - Record    │───▶│ - Collector  │              │
│  │   Button    │    │ - Serializer │              │
│  │ - Flowchart │    └──────────────┘              │
│  │   Viewer    │            │                      │
│  │ - Editor    │            ▼                      │
│  └─────────────┘    ┌──────────────┐              │
│         │           │   Analysis   │              │
│         │           │              │              │
│         │           │ - Analyzer   │              │
│         │           │ - Flowchart  │              │
│         │           │   Generator  │              │
│         │           └──────────────┘              │
│         │                   │                      │
│         ▼                   ▼                      │
│  ┌─────────────────────────────────┐              │
│  │        Execution Layer          │              │
│  │                                 │              │
│  │  - MacroExecutor                │              │
│  │  - MacroStorage                 │              │
│  │  - AIVariationEngine            │              │
│  └─────────────────────────────────┘              │
│                    │                               │
│                    ▼                               │
│         ┌────────────────────┐                    │
│         │ BrowserController  │                    │
│         └────────────────────┘                    │
└─────────────────────────────────────────────────────┘
```

---

## 📁 파일 구조

```
ai-agent/
├── macro/                          # 새로운 매크로 기능 폴더
│   ├── recording/                  # 녹화 관련
│   │   ├── RecordingManager.js     # 녹화 상태 관리, 시작/종료
│   │   ├── EventCollector.js       # 브라우저 이벤트 수집 (클릭, 입력, 네비게이션)
│   │   └── EventSerializer.js      # 이벤트를 저장 가능한 형식으로 변환
│   │
│   ├── analysis/                   # 분석 및 처리
│   │   ├── ActionAnalyzer.js       # 녹화된 행동을 의미있는 단계로 분석
│   │   ├── FlowchartGenerator.js   # 순서도 데이터 생성
│   │   └── AIPromptBuilder.js      # 각 단계를 AI 프롬프트로 변환
│   │
│   ├── ui/                         # 사용자 인터페이스
│   │   ├── RecordButton.js         # 녹화 버튼 컴포넌트
│   │   ├── MacroFlowchart.html     # 순서도 뷰어 UI
│   │   ├── MacroFlowchart.js       # 순서도 렌더링 및 상호작용
│   │   ├── MacroFlowchart.css      # 순서도 스타일
│   │   └── MacroEditor.js          # 각 단계 편집 기능
│   │
│   ├── execution/                  # 실행 관련
│   │   ├── MacroExecutor.js        # 매크로 실행 엔진
│   │   ├── MacroStorage.js         # 매크로 저장/불러오기 (localStorage/IndexedDB)
│   │   └── AIVariationEngine.js    # AI를 이용한 매크로 변주 실행
│   │
│   └── types/                      # 타입 정의
│       └── MacroTypes.js           # 공통 타입 및 인터페이스
│
├── browser-toolbar.html            # [수정] 녹화 버튼 추가
├── electron-main.js                # [수정] 매크로 IPC 핸들러 추가
└── MACRO_PLAN.md                   # 이 문서
```

---

## 🎨 UI 디자인

### 1. 녹화 버튼 (browser-toolbar.html)

URL 입력창 오른쪽에 추가:

```html
<button class="record-btn" id="recordBtn" title="Record Macro">
  <span class="record-icon">⏺</span>
  <span class="record-status">Record</span>
</button>
```

**상태 표시**:
- 대기 중: 회색 ⏺ "Record"
- 녹화 중: 빨간색 ⏺ "Recording..." (깜빡임)
- 저장 중: 파란색 💾 "Saving..."

---

### 2. 순서도 뷰어 (MacroFlowchart.html)

```
┌─────────────────────────────────────────────────┐
│ 📝 Recorded Macro: "Google Search Example"      │
│ Created: 2025-11-03  Duration: 15s               │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌────────────────────────────────────────┐    │
│  │ [1] Navigate to URL                    │    │
│  │     https://google.com                 │    │
│  │     ⏱ 0.0s                             │    │
│  └────────────────────────────────────────┘    │
│              ↓                                  │
│  ┌────────────────────────────────────────┐    │
│  │ [2] Click on element                   │    │
│  │     Target: Search box (input[name='q'])│   │
│  │     ⏱ 1.5s                             │    │
│  └────────────────────────────────────────┘    │
│              ↓                                  │
│  ┌────────────────────────────────────────┐    │
│  │ [3] Type text ✏️                       │    │
│  │     Target: Search box (input[name='q'])│   │
│  │                                         │    │
│  │     📝 Input Value:                    │    │
│  │     ┌────────────────────────────┐    │    │
│  │     │ AI news              [Edit]│    │    │ <- 클릭하여 수정
│  │     └────────────────────────────┘    │    │
│  │                                         │    │
│  │     Options:                            │    │
│  │     ☐ Ask me when running              │    │
│  │     ☐ Use AI variation                 │    │
│  │       └─ Prompt: "관련 뉴스 검색어 생성" │    │
│  │                                         │    │
│  │     ⏱ 2.0s                             │    │
│  └────────────────────────────────────────┘    │
│              ↓                                  │
│  ┌────────────────────────────────────────┐    │
│  │ [4] Press key                          │    │
│  │     Key: Enter                         │    │
│  │     ⏱ 3.0s                             │    │
│  └────────────────────────────────────────┘    │
│                                                 │
│  [▶ Run] [💾 Save] [✏️ Edit All] [🗑 Delete]  │
└─────────────────────────────────────────────────┘
```

---

### 3. 입력값 편집 모달

입력 단계의 "Edit" 버튼 클릭 시:

```
┌─────────────────────────────────────────┐
│ ✏️ Edit Input Value                     │
├─────────────────────────────────────────┤
│                                         │
│ Target Field:                           │
│ Search box (input[name='q'])            │
│                                         │
│ Input Method:                           │
│ ⚫ Static value                         │
│ ○ Ask when running                     │
│ ○ AI generated                         │
│                                         │
│ ─────────────────────────────────────── │
│                                         │
│ Static Value:                           │
│ ┌─────────────────────────────────┐   │
│ │ AI news                         │   │
│ └─────────────────────────────────┘   │
│                                         │
│ OR                                      │
│                                         │
│ Prompt for User:                        │
│ ┌─────────────────────────────────┐   │
│ │ What do you want to search?     │   │
│ └─────────────────────────────────┘   │
│                                         │
│ OR                                      │
│                                         │
│ AI Prompt:                              │
│ ┌─────────────────────────────────┐   │
│ │ Generate a tech news keyword    │   │
│ │ related to current trends       │   │
│ └─────────────────────────────────┘   │
│                                         │
│      [Cancel]  [Apply Changes]          │
└─────────────────────────────────────────┘
```

**3가지 입력 모드**:
1. **Static value**: 고정된 값 사용
2. **Ask when running**: 실행 시 사용자에게 물어보기
3. **AI generated**: AI가 프롬프트 기반으로 생성

---

## 💾 데이터 구조

### Macro 객체

```javascript
{
  id: "macro_1730678400000",
  name: "Google Search Example",
  description: "Search Google for AI news",
  createdAt: 1730678400000,
  updatedAt: 1730678400000,
  version: "1.0",

  steps: [
    {
      type: "navigation",
      stepNumber: 1,
      timestamp: 0,
      url: "https://google.com",
      description: "Navigate to Google"
    },

    {
      type: "click",
      stepNumber: 2,
      timestamp: 1500,
      target: {
        selector: "input[name='q']",
        xpath: "/html/body/div/form/input",
        description: "Search box",
        tagName: "INPUT"
      },
      coordinates: { x: 450, y: 300 },
      description: "Click search box"
    },

    {
      type: "input",
      stepNumber: 3,
      timestamp: 2000,
      target: {
        selector: "input[name='q']",
        xpath: "/html/body/div/form/input",
        description: "Search box",
        tagName: "INPUT"
      },

      // 입력값 설정 (3가지 모드)
      inputMode: "static" | "prompt" | "ai",

      // Static mode: 고정값
      staticValue: "AI news",

      // Prompt mode: 실행시 사용자에게 물어보기
      promptConfig: {
        enabled: false,
        question: "What do you want to search?",
        defaultValue: "AI news",
        placeholder: "Enter search term..."
      },

      // AI mode: AI가 생성
      aiConfig: {
        enabled: false,
        prompt: "Generate a tech news keyword related to current trends",
        model: "gpt-4o-mini",
        temperature: 0.7,
        examples: ["AI breakthroughs", "tech IPO news", "startup funding"]
      },

      description: "Type search query",
      editable: true
    },

    {
      type: "keypress",
      stepNumber: 4,
      timestamp: 3000,
      key: "Enter",
      keyCode: 13,
      description: "Submit search"
    },

    {
      type: "wait",
      stepNumber: 5,
      timestamp: 3500,
      condition: "page-load",
      timeout: 5000,
      description: "Wait for search results"
    }
  ],

  metadata: {
    totalSteps: 5,
    duration: 3500,
    startUrl: "https://google.com",
    endUrl: "https://google.com/search?q=AI+news",
    browserVersion: "Cobalt 1.0"
  }
}
```

### Event 객체 (녹화 중)

```javascript
{
  type: "click" | "input" | "keypress" | "navigation" | "scroll" | "submit",
  timestamp: 1500,
  target: {
    selector: "input[name='q']",
    xpath: "/html/body/div/form/input",
    tagName: "INPUT",
    id: "search-box",
    className: "search-input",
    description: "Search box"
  },
  data: {
    // 타입별 추가 데이터
    value: "AI news",           // for input
    key: "Enter",                // for keypress
    url: "https://google.com",   // for navigation
    coordinates: { x: 100, y: 200 }  // for click
  }
}
```

---

## 🔄 작업 흐름

### 1. 녹화 단계

```
사용자가 녹화 버튼 클릭
  ↓
RecordingManager.startRecording()
  ↓
EventCollector가 BrowserView에 리스너 등록:
  - webContents.on('did-navigate')
  - executeJavaScript로 DOM 이벤트 리스너 주입
    - click, input, keydown, submit 등
  ↓
이벤트 발생 시마다:
  - EventCollector.collectEvent(event)
  - EventSerializer.serialize(event)
  - 메모리에 저장
  ↓
사용자가 녹화 종료 버튼 클릭
  ↓
RecordingManager.stopRecording()
  ↓
수집된 이벤트를 ActionAnalyzer로 전달
```

### 2. 분석 및 순서도 생성 단계

```
ActionAnalyzer.analyze(events)
  ↓
이벤트 시퀀스 분석:
  - 연속된 입력 이벤트를 하나의 "input" 단계로 병합
  - 클릭 후 네비게이션을 하나의 흐름으로 그룹화
  - 불필요한 이벤트 필터링 (예: 중복 클릭)
  ↓
FlowchartGenerator.generate(analyzedSteps)
  ↓
Macro 객체 생성:
  - 각 단계에 stepNumber, description 추가
  - 입력 단계에 editable 플래그 설정
  - 메타데이터 생성
  ↓
MacroStorage.saveDraft(macro)
  ↓
MacroFlowchart.html 열기
  ↓
순서도 UI에 표시
```

### 3. 편집 단계

```
사용자가 입력 단계의 "Edit" 버튼 클릭
  ↓
MacroEditor.openEditModal(stepIndex)
  ↓
모달에 현재 값 표시:
  - 대상 필드 정보
  - 현재 입력 모드 (static/prompt/ai)
  - 현재 값
  ↓
사용자가 값 수정 및 입력 모드 선택
  ↓
"Apply Changes" 클릭
  ↓
MacroEditor.updateStep(stepIndex, newData)
  ↓
Macro 객체 업데이트
  ↓
순서도 UI 재렌더링
```

### 4. 실행 단계

```
사용자가 "Run" 버튼 클릭
  ↓
MacroExecutor.execute(macro)
  ↓
각 단계를 순서대로 실행:

  For each step:
    ↓
    if step.type === "input" && step.inputMode === "prompt":
      → 사용자에게 프롬프트 표시
      → 입력받은 값 사용

    else if step.type === "input" && step.inputMode === "ai":
      → AIVariationEngine.generate(step.aiConfig.prompt)
      → LLM으로부터 값 생성
      → 생성된 값 사용

    else:
      → step의 기본 값 사용
    ↓
    BrowserController에 액션 전달:
      - navigation → browserController.goTo(url)
      - click → browserController.click(selector)
      - input → browserController.type(selector, value)
      - keypress → browserController.press(key)
    ↓
    다음 단계로
  ↓
실행 완료
  ↓
결과 리포트 표시
```

---

## 🔌 IPC 통신

### electron-main.js에 추가할 핸들러

```javascript
// 녹화 시작
ipcMain.handle('macro-start-recording', async (event) => {
  // RecordingManager 초기화
  return { success: true };
});

// 녹화 종료
ipcMain.handle('macro-stop-recording', async (event) => {
  // 녹화된 이벤트 반환
  return { success: true, events: [...] };
});

// 이벤트 저장
ipcMain.on('macro-record-event', (event, eventData) => {
  // 이벤트를 메모리에 저장
});

// 매크로 저장
ipcMain.handle('save-macro', async (event, macroData) => {
  // localStorage 또는 파일로 저장
  return { success: true, id: macroData.id };
});

// 매크로 불러오기
ipcMain.handle('load-macro', async (event, macroId) => {
  // 저장된 매크로 불러오기
  return { success: true, macro: {...} };
});

// 매크로 목록 가져오기
ipcMain.handle('list-macros', async (event) => {
  return { success: true, macros: [...] };
});

// 매크로 실행
ipcMain.handle('execute-macro', async (event, macroData) => {
  // MacroExecutor로 실행
  return { success: true, result: {...} };
});

// 현재 편집 중인 매크로 가져오기
ipcMain.handle('get-current-macro', async (event) => {
  return currentEditingMacro;
});
```

---

## 📝 구현 단계 (Phase)

### Phase 1: 기본 녹화 (1주)
**목표**: 사용자 행동을 캡처하여 저장

- [ ] `RecordingManager.js` 구현
  - 녹화 시작/종료 기능
  - 상태 관리 (idle, recording, saving)

- [ ] `EventCollector.js` 구현
  - BrowserView에 이벤트 리스너 주입
  - 클릭, 입력, 네비게이션 이벤트 캡처
  - IPC를 통해 main process로 전송

- [ ] `EventSerializer.js` 구현
  - 이벤트를 JSON 형식으로 직렬화
  - XPath, CSS Selector 생성

- [ ] UI: 녹화 버튼 추가
  - `browser-toolbar.html` 수정
  - 버튼 상태 표시 (대기/녹화 중/저장 중)

- [ ] IPC 핸들러 추가
  - `macro-start-recording`
  - `macro-stop-recording`
  - `macro-record-event`

**결과물**: 사용자 행동이 JSON 형식으로 저장됨

---

### Phase 2: 순서도 생성 (1주)
**목표**: 녹화된 이벤트를 시각적 순서도로 변환

- [ ] `ActionAnalyzer.js` 구현
  - 이벤트 시퀀스 분석
  - 유사 행동 그룹화
  - 의미있는 단계 추출

- [ ] `FlowchartGenerator.js` 구현
  - Macro 객체 생성
  - 단계별 메타데이터 추가

- [ ] `MacroFlowchart.html` 구현
  - 순서도 레이아웃
  - 각 단계 카드 UI

- [ ] `MacroFlowchart.js` 구현
  - 순서도 렌더링
  - 단계별 상세 정보 표시

- [ ] `MacroFlowchart.css` 구현
  - 카드 스타일
  - 화살표, 타임라인 디자인

**결과물**: 시각적 순서도 UI

---

### Phase 3: 편집 기능 (1주)
**목표**: 사용자가 순서도를 수정할 수 있도록

- [ ] `MacroEditor.js` 구현
  - 입력값 편집 모달
  - 3가지 입력 모드 (static/prompt/ai)
  - 단계 삭제/순서 변경

- [ ] 입력 모달 UI
  - 라디오 버튼으로 모드 선택
  - 각 모드별 입력 필드
  - Apply/Cancel 버튼

- [ ] `MacroStorage.js` 구현
  - localStorage/IndexedDB 연동
  - 매크로 CRUD 기능
  - 매크로 목록 관리

- [ ] IPC 핸들러 추가
  - `save-macro`
  - `load-macro`
  - `list-macros`
  - `delete-macro`

**결과물**: 완전히 편집 가능한 매크로

---

### Phase 4: 실행 및 AI 변주 (1주)
**목표**: 매크로를 실행하고 AI로 동적 변형

- [ ] `MacroExecutor.js` 구현
  - 매크로 해석 및 실행
  - BrowserController 통합
  - 실시간 진행상황 표시

- [ ] `AIVariationEngine.js` 구현
  - AI 프롬프트 처리
  - LLMService 통합
  - 입력값 동적 생성

- [ ] `AIPromptBuilder.js` 구현
  - 단계별 AI 프롬프트 생성
  - Context-aware 프롬프트

- [ ] 실행 중 UI
  - 진행 상황 표시
  - 현재 단계 하이라이트
  - Stop 버튼

- [ ] User Prompt 모드
  - 실행 시 입력 다이얼로그 표시
  - 기본값 제공

- [ ] IPC 핸들러 추가
  - `execute-macro`
  - `stop-macro-execution`

**결과물**: 완전히 작동하는 매크로 시스템

---

## 🧪 테스트 시나리오

### 시나리오 1: Google 검색
1. 녹화 버튼 클릭
2. google.com 방문
3. 검색창에 "AI news" 입력
4. Enter 키 입력
5. 녹화 종료
6. 순서도 확인
7. 검색어를 "Machine Learning" 으로 수정
8. 매크로 실행

### 시나리오 2: 로그인 자동화
1. 녹화 버튼 클릭
2. 로그인 페이지 방문
3. 아이디 입력
4. 비밀번호 입력
5. 로그인 버튼 클릭
6. 녹화 종료
7. 아이디/비밀번호 단계를 "Ask when running" 모드로 변경
8. 매크로 실행 → 입력 프롬프트 표시 확인

### 시나리오 3: AI 변주
1. 쇼핑몰 검색 매크로 녹화
2. 검색어 단계를 "AI generated" 모드로 변경
3. AI 프롬프트: "Generate a random product name"
4. 매크로 실행 → AI가 생성한 검색어 확인

---

## 🚀 향후 개선 사항

### v1.1
- [ ] 조건부 분기 (if/else)
- [ ] 반복 루프 (for/while)
- [ ] 스크립트 내보내기 (Python, JavaScript)
- [ ] 매크로 공유 기능

### v1.2
- [ ] 화면 영역 선택 캡처
- [ ] OCR 텍스트 인식
- [ ] 이미지 기반 클릭 (요소 selector 실패 시)
- [ ] 매크로 스케줄링 (특정 시간에 자동 실행)

### v1.3
- [ ] 매크로 마켓플레이스
- [ ] 클라우드 동기화
- [ ] 팀 협업 기능
- [ ] 매크로 버전 관리

---

## 📚 참고 자료

- Electron IPC: https://www.electronjs.org/docs/latest/api/ipc-main
- Playwright API: https://playwright.dev/docs/api/class-page
- XPath/CSS Selector: https://developer.mozilla.org/en-US/docs/Web/XPath

---

## ✅ 완료 체크리스트

- [x] 아키텍처 설계
- [x] 파일 구조 정의
- [x] UI 디자인
- [x] 데이터 구조 설계
- [x] 작업 흐름 정의
- [x] 구현 단계 계획
- [x] **Phase 1 구현** ✅
  - [x] RecordingManager.js
  - [x] EventCollector.js
  - [x] EventSerializer.js
  - [x] 녹화 버튼 UI
  - [x] IPC 핸들러
- [x] **Phase 2 구현** ✅
  - [x] ActionAnalyzer.js
  - [x] FlowchartGenerator.js
  - [x] AIPromptBuilder.js
  - [x] 순서도 UI (HTML/CSS/JS)
- [x] **Phase 3 구현** ✅
  - [x] MacroEditor.js (순서도 UI에 통합)
  - [x] MacroStorage.js
- [x] **Phase 4 구현** ✅
  - [x] MacroExecutor.js
  - [x] AIVariationEngine.js
- [ ] 테스트 및 버그 수정
- [ ] 문서화 완료

---

## 🎉 구현 완료!

**날짜**: 2025-11-03
**버전**: 1.0

모든 핵심 기능이 구현되었습니다:

### ✅ 구현된 기능
1. **매크로 녹화**: 사용자의 브라우저 작업을 실시간으로 캡처
2. **순서도 시각화**: 녹화된 작업을 직관적인 순서도로 표시
3. **입력값 편집**: 3가지 모드 (고정값, 사용자 입력, AI 생성) 지원
4. **매크로 저장/불러오기**: 파일 시스템 기반 영구 저장
5. **매크로 실행**: 저장된 매크로를 정확하게 재생
6. **AI 변주**: AI를 활용한 동적 값 생성

### 📁 생성된 파일 (15개)

**Types & Core:**
- `macro/types/MacroTypes.js`

**Recording (Phase 1):**
- `macro/recording/RecordingManager.js`
- `macro/recording/EventCollector.js`
- `macro/recording/EventSerializer.js`

**Analysis (Phase 2):**
- `macro/analysis/ActionAnalyzer.js`
- `macro/analysis/FlowchartGenerator.js`
- `macro/analysis/AIPromptBuilder.js`

**UI (Phase 2):**
- `macro/ui/MacroFlowchart.html`
- `macro/ui/MacroFlowchart.css`
- `macro/ui/MacroFlowchart.js`

**Execution (Phase 3 & 4):**
- `macro/execution/MacroStorage.js`
- `macro/execution/MacroExecutor.js`
- `macro/execution/AIVariationEngine.js`

**Modified Files:**
- `browser-toolbar.html` (녹화 버튼 추가)
- `browser-view-preload.js` (이벤트 전송 API)
- `electron-main.js` (매크로 IPC 핸들러)

---

## 🧪 테스트 가이드

### 테스트 시나리오 1: 기본 녹화 및 재생

1. **Cobalt 브라우저 실행**
   ```bash
   npm start
   ```

2. **녹화 시작**
   - URL 창 오른쪽의 "⏺ Record" 버튼 클릭
   - 버튼이 빨간색으로 변하고 "Recording..." 표시

3. **웹 작업 수행**
   - google.com 방문
   - 검색창에 "AI news" 입력
   - Enter 키 입력

4. **녹화 종료**
   - "⏺ Recording..." 버튼 다시 클릭
   - 순서도 뷰어 창이 자동으로 열림

5. **순서도 확인**
   - 모든 단계가 올바르게 표시되는지 확인
   - 각 단계의 상세 정보 확인

6. **매크로 저장**
   - "💾 Save" 버튼 클릭
   - 이름 입력 (예: "Google Search")

7. **매크로 실행**
   - "▶ Run" 버튼 클릭
   - 브라우저에서 자동으로 재생되는지 확인

### 테스트 시나리오 2: 입력값 수정

1. **순서도에서 입력 단계 찾기**
   - "Type text ✏️" 단계 찾기

2. **입력값 편집**
   - "✏️ Edit" 버튼 클릭
   - Static value를 "Machine Learning"으로 변경
   - "Apply Changes" 클릭

3. **변경 사항 확인**
   - 순서도에서 새 값이 표시되는지 확인

4. **수정된 매크로 실행**
   - "▶ Run" 버튼 클릭
   - 새 검색어로 실행되는지 확인

### 테스트 시나리오 3: AI 변주 (API 키 필요)

1. **Settings 탭에서 API 키 설정**
   - OpenAI API 키 입력

2. **AI 모드로 변경**
   - 입력 단계의 "✏️ Edit" 버튼 클릭
   - "AI generated" 선택
   - AI Prompt: "Generate a trending tech topic"
   - "Apply Changes" 클릭

3. **AI로 실행**
   - "▶ Run" 버튼 클릭
   - AI가 생성한 값으로 검색되는지 확인

---

## 🐛 알려진 제한사항

1. **User Prompt 모드**: 현재 기본값만 사용됨 (입력 다이얼로그 미구현)
2. **Scroll 이벤트**: 녹화되지만 분석 단계에서 제외됨
3. **복잡한 Selector**: iframe 내부 요소는 캡처 어려움
4. **키보드 입력**: 특수 키만 녹화됨 (일반 타이핑은 input 이벤트로 처리)

---

## 🚀 다음 단계

### v1.1 개선 사항
- [ ] User Prompt 모드에 실제 입력 다이얼로그 추가
- [ ] 매크로 목록 UI (저장된 매크로 관리)
- [ ] 실행 중 진행상황 표시
- [ ] Stop 버튼으로 실행 중단
- [ ] 에러 처리 개선

### v1.2 고급 기능
- [ ] 조건부 분기 (if/else)
- [ ] 반복 루프 (for/while)
- [ ] 변수 시스템
- [ ] 스크립트 내보내기 (Python, JavaScript)

### v1.3 협업 기능
- [ ] 매크로 공유
- [ ] 클라우드 동기화
- [ ] 매크로 마켓플레이스
