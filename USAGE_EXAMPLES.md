# AI Agent - Usage Examples

## Enhanced Autonomous Web Agent

This AI agent can now perform complex web automation tasks with advanced reasoning and tool usage.

## New Capabilities

### 1. **Memory System**
The agent can now store and recall information across actions.

**Example Task:**
```
"구글에서 'OpenAI GPT-4' 검색해서 상위 3개 결과의 제목을 메모리에 저장하고,
나중에 그 정보를 사용해서 보고서 작성해줘"
```

The agent will:
1. Search Google for "OpenAI GPT-4"
2. Extract top 3 result titles
3. Use `storeMemory` to save titles
4. Use `retrieveMemory` when creating the report
5. Use `formatAsTable` to format the final report

### 2. **Mathematical Calculations**
The agent can perform calculations without making errors.

**Example Task:**
```
"이 웹페이지에서 모든 가격을 찾아서 합계를 계산해줘"
```

The agent will:
1. Navigate to the page
2. Use `extractNumbers` to find all numbers
3. Use `calculate` to sum them up
4. Return the total

### 3. **Date/Time Operations**
The agent knows current time and can calculate date differences.

**Example Task:**
```
"오늘 날짜를 확인하고, 2024년 1월 1일부터 며칠이 지났는지 계산해줘"
```

The agent will:
1. Use `getCurrentDateTime` to get today's date
2. Use `calculateDateDiff` to find the difference
3. Format the result clearly

### 4. **Smart Data Extraction**
The agent can extract structured data from text.

**Example Task:**
```
"이 페이지에서 모든 이메일 주소와 URL을 추출해서 리스트로 정리해줘"
```

The agent will:
1. Get page content
2. Use `extractEmails` to find all email addresses
3. Use `extractURLs` to find all links
4. Use `formatAsJSON` or `formatAsTable` to present results

### 5. **Complex Multi-Step Tasks**
The agent can now handle more complex workflows by using memory.

**Example Task:**
```
"구글에서 'Python tutorial' 검색하고, 첫 번째 결과 사이트에 방문해서
주요 내용을 요약하고, 그 요약을 메모리에 저장한 다음,
다시 구글로 돌아가서 'JavaScript tutorial' 검색하고 비교 보고서 만들어줘"
```

The agent will:
1. Search for "Python tutorial"
2. Visit first result and summarize
3. Use `storeMemory` to save the Python summary
4. Return to Google and search "JavaScript tutorial"
5. Visit first result and summarize
6. Use `retrieveMemory` to get the Python summary
7. Create a comparative report using both summaries

## Available Tools

### Browser Actions
- `navigate` - Go to a URL
- `click` - Click an element
- `type` - Type text into input
- `getText` - Extract text from element
- `getPageContent` - Get page content
- `pressKey` - Press keyboard key

### Multi-Tab Actions
- `createNewTab` - Open a new browser tab
- `switchTab` - Switch to a specific tab by ID
- `closeTab` - Close a specific tab
- `listTabs` - List all open tabs with IDs and URLs
- `getActiveTabId` - Get the currently active tab ID

### CAPTCHA/Challenge Tools
- `solveCaptcha` - Auto-solve CAPTCHAs
- `visionInteract` - Vision-guided interaction

### Utility Tools
- `calculate` - Mathematical calculations
- `storeMemory` / `retrieveMemory` - Store/recall information
- `getCurrentDateTime` - Get current date/time
- `calculateDateDiff` - Calculate days between dates
- `extractNumbers` / `extractEmails` / `extractURLs` - Extract data
- `formatAsTable` / `formatAsJSON` - Format output

## Tips for Best Results

### 1. **Use Specific Instructions**
Good:
```
"구글에서 'AI news' 검색하고, 상위 5개 기사 제목과 URL을 표로 정리해줘"
```

Bad:
```
"AI 뉴스 찾아줘"
```

### 2. **Break Complex Tasks Into Steps**
The agent will automatically break down tasks, but you can help by being clear:

```
"다음 단계로 작업해줘:
1. 네이버에 로그인
2. 메일함 확인
3. 읽지 않은 메일 개수 세기
4. 결과를 메모리에 저장"
```

### 3. **Use Memory for Multi-Page Tasks**
When gathering info from multiple pages, tell the agent to use memory:

```
"각 검색 결과를 방문하면서 주요 정보를 메모리에 저장하고,
마지막에 모든 정보를 모아서 종합 보고서 만들어줘"
```

### 4. **Leverage Data Tools**
For data-heavy tasks, mention formatting:

```
"모든 제품 정보를 수집해서 JSON 형식으로 정리해줘"
```

or

```
"가격 정보를 표 형태로 정리해줘"
```

## Example Workflows

### Research Task
```
Task: "AI 관련 최신 뉴스 3개를 찾아서 각 기사의 제목, URL, 주요 내용을
       표로 정리하고, 전체 요약도 작성해줘"

Agent will:
1. Navigate to Google
2. Search for "AI news"
3. Click first 3 results
4. For each page:
   - Extract title and URL
   - Summarize content
   - Store in memory
5. Use formatAsTable for structured output
6. Write comprehensive summary
```

### Shopping Comparison
```
Task: "아마존에서 'wireless headphones'를 검색하고,
       상위 5개 제품의 이름, 가격, 평점을 비교해줘"

Agent will:
1. Navigate to Amazon
2. Search for product
3. Extract product info (using extractNumbers for prices)
4. Store each product in memory
5. Use formatAsTable to create comparison table
6. Use calculate to find average price
```

### Schedule Check
```
Task: "구글 캘린더 확인해서 이번 주 일정 개수 세고,
       몇 일 남았는지 계산해줘"

Agent will:
1. Navigate to Google Calendar
2. Count events
3. Use getCurrentDateTime for today
4. Use calculateDateDiff for remaining days
5. Format comprehensive report
```

### Multi-Tab Research
```
Task: "3개의 뉴스 사이트를 동시에 열어서 각 사이트의 헤드라인 뉴스를 수집하고,
       모든 정보를 하나의 표로 정리해줘"

Agent will:
1. Create new tab for CNN, navigate to cnn.com
2. Create new tab for BBC, navigate to bbc.com
3. Create new tab for Reuters, navigate to reuters.com
4. List all tabs to see their IDs
5. Switch to first tab, extract headline, store in memory
6. Switch to second tab, extract headline, store in memory
7. Switch to third tab, extract headline, store in memory
8. Use formatAsTable to combine all headlines
9. Close extra tabs, return to main tab
```

## Model Selection

### GPT-5-mini (Recommended)
- **Best for**: Most tasks
- **Speed**: Very fast
- **Cost**: Most economical
- **Accuracy**: Excellent

### GPT-5
- **Best for**: Complex reasoning tasks
- **Speed**: Fast
- **Cost**: Moderate
- **Accuracy**: Superior

### Gemini 2.5 Pro
- **Best for**: Vision-heavy tasks
- **Speed**: Fast
- **Cost**: Moderate
- **Accuracy**: Excellent for images

### Gemini 2.5 Flash
- **Best for**: Speed-critical tasks
- **Speed**: Very fast
- **Cost**: Very low
- **Accuracy**: Good

## Troubleshooting

### Agent Fails to Complete Task
- Check if the task is within 15 iterations
- Make the task more specific
- Break into smaller subtasks

### CAPTCHA Issues
- The agent auto-solves most CAPTCHAs
- If it fails, try running the task again
- Some CAPTCHAs may require manual intervention

### Memory Not Working
- Check that you're using correct key names
- Use `listMemory` to see all stored keys
- Memory is cleared when task ends

### Calculation Errors
- Use the `calculate` tool explicitly
- Don't expect the LLM to do complex math itself
- Provide expressions as strings (e.g., "3*5+10")

## Advanced Features

### Cloudflare Bypass
The agent automatically handles Cloudflare challenges. It will:
- Wait for verification
- Handle multi-stage challenges
- Retry with different strategies

### Vision-Based Interaction
For unusual UI elements, the agent uses vision:
- Identifies buttons and checkboxes by seeing them
- Handles custom CAPTCHA implementations
- Clicks precise coordinates when needed

### Smart Retries
The agent automatically retries failed actions with:
- Different selectors
- Alternative strategies
- Vision fallback when DOM fails

## Performance Tips

### Faster Execution
1. Use specific selectors (id, name) instead of generic ones
2. Don't request full page content unless needed
3. Store extracted data in memory instead of re-navigating

### Better Accuracy
1. Be specific in task descriptions
2. Use tools explicitly (calculate, extract, format)
3. Request structured output (table, JSON)

### Handling Large Datasets
1. Use memory to accumulate data
2. Format final output with formatAsTable or formatAsJSON
3. Break into chunks if extracting 20+ items

## Limitations

- **Max 15 iterations** per task
- **Single browser instance** (one task at a time)
- **Memory cleared** after each task
- **No file downloads** (yet)
- **No form file uploads** (yet)

## Future Enhancements

Coming soon:
- [ ] File download support
- [ ] Screenshot capture and analysis
- [ ] Multi-tab management
- [ ] Persistent memory across tasks
- [ ] Custom plugin system
- [ ] API endpoint for programmatic access
