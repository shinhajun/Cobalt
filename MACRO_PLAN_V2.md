# 매크로 기능 V2 개선 계획

**날짜**: 2025-11-03
**버전**: 2.0
**이전 버전**: V1.0 (기본 녹화/재생 완료)

---

## 🎯 V2 목표

### 1. **인터랙티브 플로우차트 (React Flow)**
현재 단순 HTML 리스트 → **드래그 가능한 노드 기반 플로우차트**
- 좌우로 노드 배치 (자동 레이아웃)
- 화살표로 단계 연결
- 마우스로 패닝/줌
- 노드 클릭/편집

### 2. **AI 플로우 최적화**
불필요한 단계 자동 제거
- 중복 클릭 감지
- 의미없는 wait 제거
- 연속 입력 병합
- 최적화 제안

### 3. **AI 자동화 통합**
현재 AI 에이전트에 매크로 플로우 전달
- 플로우를 프롬프트로 변환
- AI가 플로우 이해하고 실행
- "이 매크로처럼 해줘" 명령 지원

---

## 🏗️ 아키텍처 변경사항

### V1 구조 (현재)
```
MacroFlowchart.html (Simple HTML List)
  ↓
Static Vertical Layout
  ↓
Modal Edit
```

### V2 구조 (목표)
```
React Flow Viewer (Interactive Canvas)
  ↓
Auto Layout Engine (Dagre/Elkjs)
  ↓
Node/Edge Components
  ↓
AI Optimizer ←→ AI Agent Integration
```

---

## 📦 기술 스택

### 필요한 라이브러리

#### 1. React Flow
```bash
npm install reactflow
```
- **용도**: 인터랙티브 플로우차트
- **기능**:
  - 노드/엣지 렌더링
  - 드래그 앤 드롭
  - 줌/패닝
  - 미니맵
  - 컨트롤 패널

#### 2. Dagre (자동 레이아웃)
```bash
npm install dagre
```
- **용도**: 자동 노드 배치
- **기능**:
  - 위→아래, 좌→우 레이아웃
  - 노드 간격 최적화
  - 엣지 교차 최소화

#### 3. React (Electron에서 사용)
```bash
npm install react react-dom
```
- **번들링**: Webpack 또는 Vite 필요

#### 4. Webpack (번들러)
```bash
npm install --save-dev webpack webpack-cli babel-loader @babel/preset-react
```

---

## 📁 새로운 파일 구조

```
macro/
├── ui/
│   ├── flowchart/                       # 새로운 React Flow 기반 뷰어
│   │   ├── MacroFlowViewer.jsx         # 메인 React 컴포넌트
│   │   ├── nodes/
│   │   │   ├── NavigationNode.jsx      # 네비게이션 노드
│   │   │   ├── ClickNode.jsx           # 클릭 노드
│   │   │   ├── InputNode.jsx           # 입력 노드 (편집 가능)
│   │   │   ├── WaitNode.jsx            # Wait 노드
│   │   │   └── KeypressNode.jsx        # 키프레스 노드
│   │   ├── edges/
│   │   │   └── CustomEdge.jsx          # 커스텀 화살표
│   │   ├── layout/
│   │   │   └── AutoLayout.js           # Dagre 레이아웃 엔진
│   │   ├── controls/
│   │   │   ├── Toolbar.jsx             # 툴바 (Run, Save, Optimize)
│   │   │   └── Minimap.jsx             # 미니맵
│   │   └── MacroFlowViewer.css         # 스타일
│   │
│   ├── MacroFlowchart.html             # React 앱 마운트 포인트 (수정)
│   └── index.jsx                        # React 엔트리 포인트
│
├── optimization/                        # AI 최적화 모듈 (새로 생성)
│   ├── FlowOptimizer.js                # 플로우 최적화 엔진
│   ├── StepMerger.js                   # 단계 병합 로직
│   ├── DuplicateDetector.js            # 중복 감지
│   └── OptimizationPrompts.js          # AI 최적화 프롬프트
│
└── integration/                         # AI 통합 모듈 (새로 생성)
    ├── MacroToPrompt.js                # 매크로 → AI 프롬프트 변환
    ├── AIAgentBridge.js                # AI 에이전트와 통신
    └── FlowExecutor.js                 # AI가 플로우 실행하도록 지원
```

---

## 🎨 React Flow 디자인

### 노드 타입별 디자인

#### 1. Navigation Node (네비게이션)
```
┌──────────────────────────┐
│ 🌐 Navigate              │
│                          │
│ https://google.com       │
└──────────────────────────┘
        ↓
```
- 색상: 파란색 그라데이션
- 아이콘: 🌐
- 필드: URL

#### 2. Input Node (입력)
```
┌──────────────────────────┐
│ ✏️ Type Text             │
│                          │
│ "AI news"                │
│ [Static ▼] [Edit]        │
└──────────────────────────┘
        ↓
```
- 색상: 초록색 그라데이션
- 아이콘: ✏️
- 필드: 값, 모드 (Static/Prompt/AI)
- 인라인 편집 가능

#### 3. Click Node (클릭)
```
┌──────────────────────────┐
│ 👆 Click                 │
│                          │
│ Search Button            │
└──────────────────────────┘
        ↓
```
- 색상: 주황색 그라데이션
- 아이콘: 👆
- 필드: 타겟 설명

#### 4. Wait Node (대기)
```
┌──────────────────────────┐
│ ⏱️ Wait                  │
│                          │
│ 2.5s (Page Load)         │
└──────────────────────────┘
        ↓
```
- 색상: 회색
- 아이콘: ⏱️
- 필드: 시간, 조건

### 레이아웃 방향

**Horizontal (좌→우 기본)**
```
[Start] → [Navigate] → [Click] → [Input] → [Enter] → [End]
```

**Branching (조건부 - V2.1)**
```
            ┌→ [Success Path]
[Check] ───┤
            └→ [Error Path]
```

---

## 🤖 AI 최적화 기능

### 1. 불필요한 단계 제거

**FlowOptimizer.js**

```javascript
class FlowOptimizer {
  async optimize(macro) {
    const steps = macro.steps;

    // 1. 중복 클릭 제거
    const withoutDuplicates = this.removeDuplicateClicks(steps);

    // 2. 의미없는 Wait 제거
    const withoutUselessWaits = this.removeUselessWaits(withoutDuplicates);

    // 3. 연속 입력 병합
    const merged = this.mergeConsecutiveInputs(withoutUselessWaits);

    // 4. AI에게 추가 최적화 제안 요청
    const aiSuggestions = await this.getAISuggestions(merged);

    return {
      optimizedSteps: merged,
      removedSteps: this.getRemovedSteps(steps, merged),
      aiSuggestions
    };
  }

  removeDuplicateClicks(steps) {
    // 같은 요소를 100ms 내에 두 번 클릭 → 하나만 남김
  }

  removeUselessWaits(steps) {
    // 500ms 이하 wait 제거
    // 마지막 단계의 wait 제거
  }

  mergeConsecutiveInputs(steps) {
    // 같은 입력 필드에 연속 입력 → 하나로 병합
  }
}
```

### 2. AI 최적화 프롬프트

**OptimizationPrompts.js**

```javascript
static buildOptimizationPrompt(macro) {
  return `
Analyze this web automation macro and suggest optimizations:

Macro: "${macro.name}"
Total Steps: ${macro.steps.length}

Steps:
${macro.steps.map((step, i) =>
  `${i+1}. [${step.type}] ${step.description}`
).join('\n')}

Please identify:
1. Redundant or duplicate steps
2. Steps that can be merged
3. Unnecessary wait times
4. Steps that could be simplified

Return a JSON object:
{
  "redundantSteps": [step numbers],
  "mergeSuggestions": [{from: [steps], to: "new description"}],
  "recommendations": ["text descriptions"]
}
  `;
}
```

---

## 🔗 AI 자동화 통합

### 목표
현재 AI 에이전트가 **매크로 플로우를 보고 직접 실행**할 수 있게

### 구현 방법

#### 1. Macro → AI Prompt 변환

**MacroToPrompt.js**

```javascript
class MacroToPrompt {
  /**
   * 매크로를 AI가 이해할 수 있는 프롬프트로 변환
   */
  static convert(macro) {
    let prompt = `Execute this web automation workflow:\n\n`;

    prompt += `Goal: ${macro.name}\n`;
    prompt += `Description: ${macro.description || 'N/A'}\n\n`;

    prompt += `Steps to perform:\n`;

    macro.steps.forEach((step, index) => {
      prompt += `${index + 1}. `;

      switch (step.type) {
        case 'navigation':
          prompt += `Navigate to ${step.url}\n`;
          break;

        case 'click':
          prompt += `Click on "${step.target.description}" (selector: ${step.target.selector})\n`;
          break;

        case 'input':
          if (step.inputMode === 'ai') {
            prompt += `Type text in "${step.target.description}": ${step.aiConfig.prompt}\n`;
          } else {
            prompt += `Type "${step.staticValue}" in "${step.target.description}"\n`;
          }
          break;

        case 'keypress':
          prompt += `Press ${step.key} key\n`;
          break;

        case 'wait':
          prompt += `Wait ${step.timeout}ms for ${step.condition}\n`;
          break;
      }
    });

    prompt += `\nUse the browser automation tools to execute these steps.`;

    return prompt;
  }
}
```

#### 2. AI Agent Bridge

**AIAgentBridge.js**

```javascript
class AIAgentBridge {
  /**
   * AI 에이전트에게 매크로 플로우 전달
   */
  async executeWithAI(macro, agentContext) {
    // 1. 매크로를 프롬프트로 변환
    const prompt = MacroToPrompt.convert(macro);

    // 2. 현재 AI 에이전트 시스템에 전달
    const { LLMService } = require('../../packages/agent-core/dist/llmService');
    const llm = new LLMService('gpt-4o');

    // 3. 시스템 프롬프트에 브라우저 제어 능력 추가
    const systemPrompt = `You are a browser automation assistant.
You have access to browser control functions:
- navigate(url)
- click(selector)
- type(selector, text)
- press(key)
- wait(ms)

Execute the user's workflow step by step.`;

    // 4. AI에게 실행 요청
    const response = await llm.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ], {
      tools: this.getBrowserTools(), // 브라우저 제어 함수들
      tool_choice: 'auto'
    });

    return response;
  }

  getBrowserTools() {
    return [
      {
        type: 'function',
        function: {
          name: 'navigate',
          description: 'Navigate to a URL',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to navigate to' }
            }
          }
        }
      },
      // ... click, type, press 등
    ];
  }
}
```

#### 3. 사용자 인터페이스

**플로우차트 툴바에 버튼 추가**

```
[▶ Run]  [🤖 AI Execute]  [⚡ Optimize]  [💾 Save]
```

- **Run**: 기존 MacroExecutor로 실행 (정확)
- **AI Execute**: AI 에이전트가 플로우 보고 실행 (유연)
- **Optimize**: AI가 플로우 최적화
- **Save**: 저장

---

## 📋 구현 단계

### Phase 1: React Flow 설정 ✅
- [ ] 1.1. React, React Flow, Dagre 설치
- [ ] 1.2. Webpack 설정 (React 번들링)
- [ ] 1.3. MacroFlowchart.html을 React 마운트 포인트로 수정
- [ ] 1.4. 기본 React Flow 캔버스 렌더링

### Phase 2: 커스텀 노드 구현 ✅
- [ ] 2.1. NavigationNode 컴포넌트
- [ ] 2.2. ClickNode 컴포넌트
- [ ] 2.3. InputNode 컴포넌트 (인라인 편집)
- [ ] 2.4. WaitNode, KeypressNode
- [ ] 2.5. 커스텀 화살표 (AnimatedEdge)

### Phase 3: 자동 레이아웃 ✅
- [ ] 3.1. Dagre 레이아웃 엔진 통합
- [ ] 3.2. 좌→우 방향 레이아웃
- [ ] 3.3. 노드 간격, 패딩 조정
- [ ] 3.4. 미니맵, 컨트롤 추가

### Phase 4: 편집 기능 ✅
- [ ] 4.1. 노드 클릭 → 편집 패널 표시
- [ ] 4.2. 입력 노드 값 변경
- [ ] 4.3. 노드 추가/삭제 버튼
- [ ] 4.4. 변경사항 저장

### Phase 5: AI 최적화 ✅
- [ ] 5.1. FlowOptimizer 구현
- [ ] 5.2. 중복 제거, 병합 로직
- [ ] 5.3. AI 최적화 프롬프트
- [ ] 5.4. 최적화 결과 UI (변경사항 하이라이트)

### Phase 6: AI 자동화 통합 ✅
- [ ] 6.1. MacroToPrompt 변환기
- [ ] 6.2. AIAgentBridge 구현
- [ ] 6.3. LLMService에 브라우저 툴 추가
- [ ] 6.4. "AI Execute" 버튼 구현

### Phase 7: 테스트 및 개선 ✅
- [ ] 7.1. 복잡한 매크로 테스트
- [ ] 7.2. 성능 최적화 (큰 플로우 처리)
- [ ] 7.3. 에러 처리
- [ ] 7.4. UI/UX 개선

---

## 🎬 사용 시나리오

### 시나리오 1: 플로우 최적화

```
1. 매크로 녹화 (10개 단계)
2. 플로우차트 열기 → React Flow 뷰어 표시
3. "⚡ Optimize" 버튼 클릭
4. AI가 분석:
   - 중복 클릭 2개 발견
   - 불필요한 wait 1개 발견
   - 최적화 후 7개 단계로 축소
5. 변경사항 하이라이트 표시 (빨간색: 삭제, 초록색: 병합)
6. "Accept" 클릭 → 최적화된 버전으로 교체
```

### 시나리오 2: AI 자동 실행

```
1. 복잡한 매크로 생성 ("온라인 쇼핑 자동화")
2. 플로우차트에서 "🤖 AI Execute" 클릭
3. AI가 플로우 읽기:
   "1. 쇼핑몰 접속
    2. 검색어 입력: [AI 생성]
    3. 첫 번째 상품 클릭
    ..."
4. AI가 단계별 실행:
   - 브라우저 제어 툴 호출
   - 유연하게 셀렉터 찾기
   - 에러 시 재시도
5. 실행 완료 리포트
```

### 시나리오 3: 대화형 실행

```
User: "구글에서 AI 뉴스 검색하는 매크로처럼 해줘"

AI Agent:
1. 저장된 매크로 검색
2. "Google Search AI News" 매크로 발견
3. 플로우 읽기
4. 사용자에게 확인: "이 플로우를 실행할까요?"
   [Navigate → google.com]
   [Type → "AI news"]
   [Press → Enter]
5. 실행 또는 수정
```

---

## 🎨 UI 디자인 목업

### React Flow 플로우차트 화면

```
┌────────────────────────────────────────────────────────────┐
│ Macro: Google Search AI News                   [X] Close  │
├────────────────────────────────────────────────────────────┤
│ [▶ Run] [🤖 AI Execute] [⚡ Optimize] [💾 Save] [🗑 Delete] │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  [🟢 Start]                                                │
│      ↓                                                     │
│  ┌─────────────────┐                                      │
│  │ 🌐 Navigate     │                                      │
│  │ google.com      │                                      │
│  └─────────────────┘                                      │
│      ↓                                                     │
│  ┌─────────────────┐                                      │
│  │ 👆 Click        │                                      │
│  │ Search Input    │                                      │
│  └─────────────────┘                                      │
│      ↓                                                     │
│  ┌─────────────────┐                                      │
│  │ ✏️ Type Text    │                                      │
│  │ "AI news"       │                                      │
│  │ [Static ▼] [✏️] │ ← 클릭 시 인라인 편집                 │
│  └─────────────────┘                                      │
│      ↓                                                     │
│  ┌─────────────────┐                                      │
│  │ ⌨️ Press Key    │                                      │
│  │ Enter           │                                      │
│  └─────────────────┘                                      │
│      ↓                                                     │
│  [🔴 End]                                                  │
│                                                            │
│  [Mini Map]                                                │
│  ┌───────┐                                                 │
│  │ ▪ ▪ ▪ │                                                 │
│  │ ▪ ▪   │                                                 │
│  └───────┘                                                 │
└────────────────────────────────────────────────────────────┘
```

### 최적화 결과 화면

```
┌────────────────────────────────────────────────────────────┐
│ Optimization Results                                       │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ ✅ Optimized: 10 steps → 7 steps (30% reduction)          │
│                                                            │
│ Changes:                                                   │
│ ❌ Removed duplicate click on "Search Button" (Step 3)     │
│ ❌ Removed unnecessary wait (Step 6, 100ms)                │
│ ✅ Merged consecutive inputs (Steps 4-5)                   │
│                                                            │
│ AI Suggestions:                                            │
│ 💡 Consider using AI mode for search term variation        │
│ 💡 Add error handling for missing elements                 │
│                                                            │
│              [Accept] [Reject] [Preview]                   │
└────────────────────────────────────────────────────────────┘
```

---

## 🔧 기술적 고려사항

### 1. React in Electron 통합

**방법 A: Webpack 번들링 (권장)**
```javascript
// webpack.config.js
module.exports = {
  entry: './macro/ui/index.jsx',
  output: {
    path: path.resolve(__dirname, 'macro/ui/dist'),
    filename: 'bundle.js'
  },
  module: {
    rules: [
      {
        test: /\.jsx$/,
        use: 'babel-loader'
      }
    ]
  }
};
```

**방법 B: Vite (빠름)**
```javascript
// vite.config.js
export default {
  base: './',
  build: {
    outDir: 'macro/ui/dist'
  }
};
```

### 2. React Flow 성능 최적화

- **큰 플로우 (100+ 노드)**: Virtualization 사용
- **메모이제이션**: React.memo() 적용
- **shouldComponentUpdate**: 불필요한 리렌더 방지

### 3. AI 통합 보안

- **샌드박싱**: AI가 실행하는 브라우저 액션 제한
- **확인 프롬프트**: 중요한 액션 전에 사용자 확인
- **로깅**: 모든 AI 액션 로그 기록

---

## 📊 예상 성능

| 항목 | V1 (HTML) | V2 (React Flow) |
|------|-----------|-----------------|
| 노드 렌더링 | 즉시 | ~100ms |
| 인터랙션 | 없음 | 드래그/줌/패닝 |
| 편집 | 모달 | 인라인 |
| 레이아웃 | 세로 고정 | 자동 최적화 |
| 최적화 | 없음 | AI 기반 |
| AI 통합 | 없음 | 완전 통합 |

---

## 🚀 다음 단계

### 즉시 시작 가능한 작업
1. ✅ **Phase 1**: React Flow 설치 및 기본 설정
2. ✅ **Phase 2**: NavigationNode, ClickNode 구현
3. ✅ **Phase 3**: Dagre 자동 레이아웃

### 중기 목표
4. ✅ **Phase 4**: 편집 기능 완성
5. ✅ **Phase 5**: AI 최적화 구현

### 장기 목표
6. ✅ **Phase 6**: AI 자동화 완전 통합
7. ✅ **Phase 7**: 고급 기능 (조건부, 루프)

---

## ❓ 사용자 질문

계획을 검토 후 결정해야 할 사항:

1. **React Flow vs 다른 라이브러리?**
   - React Flow (추천): 가장 성숙, 문서 좋음
   - Rete.js: 더 유연하지만 복잡
   - GoJS: 상용 라이선스 필요

2. **번들러 선택?**
   - Webpack (안정적)
   - Vite (빠름)

3. **AI 모델 선택?**
   - gpt-4o (비싸지만 정확)
   - gpt-4o-mini (빠르고 저렴)

4. **우선순위?**
   - React Flow 먼저? (시각화)
   - AI 최적화 먼저? (실용성)

---

**이 계획으로 진행할까요? 수정하고 싶은 부분이 있나요?**
