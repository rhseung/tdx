# tdx

Todoist를 쓰면서 부족했던 기능을 채우는 개인 툴킷입니다. `td` CLI를 확장하는 느낌으로
쓰도록 만들었습니다. 출력은 Ink로 그리고, 파이프로 넘기면 fzf가 읽기 좋은 평문으로 바뀝니다.

| 기능 | 명령 | 하는 일 |
| --- | --- | --- |
| GitHub 동기화 | `tdx gh sync` | 나에게 assign 된 issue와 PR을 Todoist로 옮깁니다 |
| 반복 과제 | `tdx recur` | 매주 금요일 마감 같은 과제를 회차마다 deadline 이 달린 task로 만듭니다 |
| 마감 임박 | `tdx nudge` | deadline은 있고 due가 없는 task를 마감 2일 전에 Today로 올립니다 |

launchd 에이전트가 `tdx run`을 120초마다 호출해서 켜 둔 기능을 모두 한 번씩 돌립니다.
한 기능이 실패해도 나머지는 계속 돕니다.

## 설치

```bash
mise install          # bun, fnox
bun install
bun link              # tdx 를 PATH 에 올림
tdx install           # launchd 등록, 120초마다 실행
```

`~/.zshrc`에 한 줄을 넣으면 `td recur`, `td gh`처럼 `td`의 하위 명령으로 부를 수 있습니다.
`td`에는 플러그인 기능이 없어서, 앞에 셸 함수를 하나 두고 tdx의 명령만 tdx로 넘깁니다.
나머지는 원래 `td`가 그대로 받습니다.

```bash
eval "$(tdx init zsh)"
```

TAB 완성은 한 번 설치합니다. 스크립트는 명령마다 선언한 zod 스키마에서 만들어지므로 하위 명령, 옵션,
선택지(`--color`의 `auto always never`, `enable`의 기능 이름)가 그대로 완성됩니다. 템플릿 id 자리에서는
Todoist에서 템플릿 목록을 읽어 `id -- 이름`으로 보여 줍니다.

```bash
tdx completion install   # ~/.local/share/zsh/site-functions/_tdx 에 씁니다. 새 셸부터 적용
```

이 디렉터리가 `fpath`에 있고 `compinit`보다 먼저 추가되어 있어야 합니다. 명령이나 옵션을 추가했다면
다시 설치합니다. `eval "$(tdx init zsh)"`를 넣어 두었다면 `td recur` 같은 확장 명령도 완성되고,
`td`의 원래 명령은 `td completion install`로 설치한 td 자체 완성을 그대로 씁니다. 이 경우 `eval` 줄은
td 완성 설정보다 뒤에 둡니다.

`gh`와 `td`에 로그인되어 있으면 따로 설정할 항목이 없습니다. 토큰을 따로 두고 싶으면
fnox에 넣습니다. `fnox.toml`에 `TODOIST_API_TOKEN`과 `GITHUB_TOKEN`이 선언되어 있고,
`fnox exec -- tdx ...`로 실행하면 그 값을 먼저 씁니다. launchd 에이전트는 fnox를 거치지
않고 `gh`와 `td`의 토큰을 씁니다. 백그라운드에서 1Password 인증 창이 뜨면 안 되기 때문입니다.

설치는 checkout 한 위치 한 곳만 유지합니다. state 파일이 두 벌이 되면 Todoist에도 tree가
두 개 생기기 때문입니다.

## 명령

```bash
tdx run                     # 켜 둔 기능을 모두 한 번 실행 (launchd 가 부르는 명령)
tdx run --dry-run --only gh # 계획만 보기, 기능 골라 돌리기
tdx gh sync --dry-run       # 실행 계획만 출력하고 아무것도 쓰지 않음
tdx gh sync --force         # 대량 완료 가드 해제
tdx gh sync --grace 14      # 빈 section 유예 기간 (기본 7일)
tdx recur                   # 반복 과제 템플릿 목록. 터미널에서는 대화형 화면
tdx recur new               # 폼으로 템플릿 만들기
tdx recur edit [id]         # 폼으로 고치기 (id 없으면 골라서)
tdx recur preview [id]      # 회차별 deadline, due, 생성일, 상태
tdx recur show [id]         # 템플릿 하나의 규칙과 다음 회차 (id 없으면 골라서)
tdx recur run --dry-run     # 지금 만들 회차 확인
tdx recur rm [id...]        # 템플릿 삭제, 이미 만든 task는 남음 (id 없으면 여러 개 골라서)
tdx nudge                   # deadline만 있는 task와 Today로 올라갈 날
tdx nudge run --dry-run     # 지금 올릴 task 확인 (--days 로 기준 조절)
tdx status                  # 에이전트 상태와 기능별 마지막 실행 결과
tdx enable gh / disable gh  # tdx run 에 넣고 빼기
tdx install / uninstall     # launchd 등록과 해제 (--interval 로 주기 조절)
```

로그는 `~/Library/Logs/tdx.log`에 기록됩니다.

## 언어

화면 문구와 도움말은 영어와 한국어를 지원합니다. 시스템 로케일을 따르고(`LC_ALL`,
`LC_MESSAGES`, `LANG` 순), `TDX_LANG`으로 덮어쓸 수 있습니다.

```bash
export TDX_LANG=ko   # 로케일이 en_US 여도 한국어로
```

Todoist 용어는 Todoist 한국어 화면을 따릅니다. due date는 날짜, deadline은 마감일, Inbox는
관리함입니다. 파이프와 JSON으로 나가는 값(탭으로 나눈 필드, 변경 종류, JSON 키)과 launchd
로그는 스크립트가 읽는 형식이라 언어와 상관없이 그대로입니다. 템플릿 규칙의 키(`every:`,
`from:` …)와 그 오류 메시지도 영어로 둡니다.

## 출력

모든 명령은 세 가지 방식 중 하나로 출력합니다.

| 상황 | 출력 |
| --- | --- |
| 터미널 | Ink 화면. 표는 한 화면에 들어가면 그대로 출력하고, 넘치면 머리행을 고정한 스크롤 뷰어로 엽니다 |
| `--json` | 스크립트가 읽을 JSON |
| 파이프, launchd | 한 줄에 레코드 하나. 첫 열은 id이고 열은 탭으로 나눕니다. 진행 단계 로그는 stderr로 보내므로 stdout에는 데이터만 남습니다 |

스크롤 뷰어에서는 `j`/`k`, 방향키, 마우스 휠, `PgUp`/`PgDn`, `g`/`G`로 움직이고 `q`로
나갑니다. `--no-pager`를 주면 뷰어를 열지 않고 전부 출력합니다.

평문은 fzf에 그대로 넘길 수 있게 맞춰 두었습니다. `--header`는 머리행을 한 줄 붙이므로
`fzf --header-lines=1`과 함께 쓰고, `--color always`는 `fzf --ansi`에서 색을 살립니다.
id를 받는 명령에 `-`를 주면 stdin에서 한 줄에 하나씩 읽고, 각 줄의 첫 열만 씁니다.

```bash
tdx recur --color always | fzf --ansi -m --preview 'tdx recur show {1}' | tdx recur rm -
```

## 반복 과제

Todoist의 deadline에는 반복 규칙이 없습니다. 반복은 due에만 붙고, 그마저도 이번 회차를
완료해야 다음 회차가 생깁니다. 그런데 과제는 지난주 것을 냈는지와 상관없이 일정대로
나옵니다. 그래서 이 기능은 완료가 아니라 달력을 기준으로 움직입니다. 규칙에 적힌
deadline마다 그보다 `lead`일 앞선 날에 task를 하나씩 만듭니다.

규칙은 Todoist의 `Templates` project에 둡니다. 그 안의 최상위 task 하나가 템플릿 하나입니다.
due가 없으므로 Today나 Upcoming에는 뜨지 않고, 평범한 task라서 휴대폰 앱에서도 규칙을
고칠 수 있습니다.

| 템플릿의 | 쓰임 |
| --- | --- |
| 제목 | 회차 task 이름. `{n}`은 회차 번호, `{date}`는 마감일(`10/2`)로 바뀝니다 |
| 설명 | 아래 규칙. `---` 아래에 적은 내용은 회차 task의 설명으로 복사됩니다 |
| 하위 task | 회차마다 그대로 복제됩니다. 제목의 `{n}`도 바뀝니다 |
| label, 우선순위 | 그대로 복사됩니다. 둘 다 폼에서 고를 수 있습니다 |

```
every: fri            # 요일. 월/화/수/목/금/토/일도 됩니다. `2 weeks mon, thu`, `month 15`
from: 2026-09-04      # 첫 회차 마감일
until: 2026-12-18     # 마지막 날 (선택)
skip: 2026-10-23, 2026-10-30   # 휴강, 시험 주간 (선택)
lead: 5d              # 마감 며칠 전에 만들지 (기본 7d)
due: -2d              # 마감 기준 due (선택). 이 날 Today에 뜹니다
project: 화학실험      # 만들 곳. 없으면 Inbox
section: 실험 보고서    # 그 프로젝트 안의 섹션 (선택)
---
실험복 지참
```

템플릿은 `tdx recur new`의 폼으로 만드는 편이 쉽습니다. 모든 항목이 한 화면에 있고,
값을 바꿀 때마다 아래에 앞으로의 마감일이 다시 그려집니다. 날짜는 달력에서 고르고,
건너뛸 날을 고를 때는 규칙이 만드는 마감일이 달력에 표시됩니다. 폼은 설명을 직접 쓰지
않고 스케줄러와 같은 파서를 거친 규칙만 저장하므로, 폼으로 만든 템플릿과 휴대폰에서 고친
템플릿이 같은 모양이 됩니다.

| 화면 | 키 |
| --- | --- |
| 목록 (`tdx recur`) | `n` 새로 만들기, `e` 고치기, `d` 삭제, `enter` 회차 미리보기, `q` 나가기 |
| 폼 | `↑`/`↓` 항목 이동, `←`/`→` 값 바꾸기, `enter` 편집, `x` 비우기, `ctrl+s` 저장, `esc` 취소 |
| 라벨 | `enter`로 목록 열기, `space`로 여러 개 표시, `enter`로 확인. `a`는 새 라벨을 입력합니다 |
| 우선순위 | `←`/`→`로 바꾸기, `1`-`4`로 p1-p4 바로 지정. 새 템플릿은 p4로 시작합니다 |
| id를 받는 명령 | id를 빼면 이름으로 고르는 목록이 뜹니다. `rm`은 `space`로 여러 개를 고르고 한 번 더 확인합니다 |
| 요일 | `←`/`→` 이동, `space` 또는 `1`-`7` 켜고 끄기 |
| 달력 | 방향키 이동, `[` `]` 달 넘기기, `t` 오늘, `space` 여러 날 고르기, `enter` 확정 |

`TDX_PICKER=fzf`를 두면 id 없이 부른 명령이 fzf로 고릅니다. 새 라벨은 템플릿을 저장할 때 Todoist 개인 라벨로도 만들어서, Todoist 앱의 라벨 목록에 나옵니다. `tdx init zsh`는 fzf가
있으면 이 값을 켜고, 템플릿을 골라 바로 폼을 여는 `tdx-edit` 함수도 만듭니다.

회차 번호는 건너뛴 주를 빼고 셉니다. 휴강한 주가 번호를 차지하지 않으므로 "3주차"가 세
번째 실험과 맞아떨어집니다.

- 이미 만든 회차는 다시 만들지 않습니다. 만든 task를 지워도 마찬가지입니다.
- 템플릿의 `project`나 `section`을 바꾸면, 이미 만든 회차 중 아직 끝내지 않았고 **예전 위치에
  그대로 있는** task를 새 위치로 옮깁니다. 손으로 다른 곳에 옮겨 둔 task는 그대로 둡니다.
- 템플릿을 고치면 이미 만든 회차 중 **아직 끝내지 않은 것**도 따라 고칩니다. 완료한 회차는 건드리지
  않습니다.
  - 제목, 메모, label, 우선순위, 날짜를 새 규칙에 맞춥니다. skip이 바뀌어 회차 번호가 밀리면 제목의
    번호도 바뀝니다. 손으로 바꾼 필드는 그대로 둡니다. tdx가 마지막으로 쓴 값을 기억해 두고, Todoist의
    값이 그와 다르면 손으로 바꾼 것으로 봅니다.
  - 요일을 바꾸거나 skip에 넣거나 종료일을 당겨서 **규칙에서 빠진 회차**는 삭제합니다. 다만 코멘트가
    있거나 손으로 바꾼 필드가 있으면 남겨 두고, 실행 결과에 "남김"으로 알립니다.
  - 새로 생긴 마감일은 평소처럼 만들 시점이 되면 만듭니다.
  - 폼에서 저장하면 이 과정을 바로 돌리고 무엇이 바뀌었는지 보여 줍니다. 템플릿을 휴대폰에서 고쳤다면
    다음 실행(최대 2분)에 반영됩니다.
  - 이 기능이 생기기 전에 만든 회차는 처음 볼 때의 모습을 tdx가 쓴 값으로 간주합니다.
- 마감이 지난 회차는 만들지 않습니다. 학기 중간에 템플릿을 써도 지난주 과제가 쏟아지지
  않습니다.
- 맥이 며칠 잠들어 있다가 깨어나면 그사이 만들었어야 할 회차를 한꺼번에 만듭니다.
- 규칙을 잘못 적으면 그 템플릿에 무엇이 틀렸는지 comment를 한 번 답니다. 나머지 템플릿은
  계속 돕니다.
- 한 번에 30개 넘게 만들려는 템플릿은 `lead` 오타로 보고 멈춥니다.

## GitHub 동기화

동기화는 GitHub에서 Todoist로 향하는 한 방향으로만 이루어집니다. issue가 닫히거나
assign이 해제되면 Todoist task도 완료 처리됩니다. not planned나 duplicate로 닫힌
issue와 merge 되지 않고 닫힌 PR만 완료가 아니라 삭제합니다. 반대 방향으로는 동기화되지
않습니다. 즉, Todoist에서 task를 완료해도 GitHub issue는 그대로 남습니다.

```
GitHub                          <- 부모 project
├─ (개인 repo section들)         <- owner가 User인 repo
├─ gsainfoteam                  <- owner가 Organization이면 sub-project
│  ├─ account-fe                <- section = repo
│  └─ ziggle-fe
└─ studio-void
   └─ campass-fe
```

task 이름은 `[#61](https://github.com/.../issues/61) 비밀번호 찾기 페이지` 와 같은
형태입니다. Todoist가 markdown을 렌더링하므로 `#61`을 누르면 해당 issue로 이동합니다.
repo 이름은 section에 이미 표시되므로 task 이름에서는 제외했습니다.

### 수집 대상

| 소스 | endpoint |
| --- | --- |
| 로그인한 사용자에게 assign 된 open issue와 PR | `GET /issues?filter=assigned&state=open` |
| review 요청받은 PR | `GET /search/issues?q=is:pr is:open review-requested:@me` |
| 사용자가 연 open PR | `GET /search/issues?q=is:pr is:open author:@me` |
| 사용자가 열었고 아무도 맡지 않은 open issue | `GET /search/issues?q=is:issue is:open author:@me no:assignee` |

마지막 줄에 `no:assignee`가 붙어 있는 이유는, 내가 연 issue 라도 다른 사람이 assign 되어
있으면 그 사람의 작업이기 때문입니다. 내가 assign 된 issue는 위의 assign 목록으로 이미
들어옵니다.

archive 된 repo는 수집 대상에서 제외합니다. 어차피 손댈 수 없는 작업이므로 목록에 남아
있으면 방해가 되기 때문입니다.

| 필드 | 규칙 |
| --- | --- |
| 우선순위 | PR은 p2, issue는 p4 |
| label | PR은 `gh-pr` (보라), issue는 `gh-issue` (초록), 막힌 issue는 `gh-blocked` (빨강). 직접 붙인 label은 그대로 유지합니다 |
| 설명 | 열려 있는 의존 관계. `blocked by #39`, `blocks #30, #40` 꼴이고 다른 저장소는 `owner/repo#12` 로 적습니다 |
| 마감일 | GitHub milestone의 `due_on` 값을 사용합니다. 값이 없으면 비워 둡니다 |

### 정렬

같은 section 안에서 task는 이슈 번호가 아니라 의존 관계 순으로 놓입니다. 축이 셋입니다.

| 축 | 뜻 |
| --- | --- |
| 막는 것 | 앞을 막고 있는 열린 이슈의 수. 사슬 전체를 셉니다. 0이면 지금 착수할 수 있고, 많이 막혀 있을수록 뒤로 갑니다 |
| 푸는 것 | 뒤에서 기다리는 이슈의 수. 이것도 사슬 전체를 세므로 셋을 연달아 푸는 일과 셋을 한꺼번에 푸는 일이 같은 무게가 됩니다 |
| 번호 | 나머지가 같을 때 쓰는 마지막 기준 |

막는 것을 사슬까지 세면 그 자체가 위상 순서가 됩니다. B가 A를 막으면 A는 B가 기다리는
것을 전부 기다리는 데다 B까지 기다리므로, A의 수가 반드시 더 큽니다. 그래서 깊이를 따로
재지 않습니다.

그래서 남을 가장 많이 푸는 일이 맨 위에, 아무것도 막지 않고 막히지도 않은 일이 가운데,
가장 많이 막힌 일이 맨 아래에 옵니다. 막힌 task에는 `gh-blocked`가 붙으므로 Todoist 필터에
`!@gh-blocked`를 걸면 지금 손댈 수 있는 것만 남습니다.

닫힌 이슈는 더 이상 막지 않으므로 관계에서 빠집니다. 의존 관계는 GraphQL의 `blockedBy`
와 `blocking`으로 한 번에 100개씩 읽으므로 이슈가 늘어도 호출이 이슈 수만큼 늘지
않습니다.

REST 쪽에 순서를 세우는 자리가 없어서 재정렬만 sync 명령을 씁니다. 순서가 어긋난
section에만 한 번씩 나갑니다.

### 안전장치

GitHub 호출이 하나라도 실패하면 Todoist에는 아무것도 기록하지 않습니다. 빈 응답을 목표
상태로 잘못 인식해서 전부 완료 처리해 버리는 상황을 막기 위해서입니다.

API 응답과 state 파일은 zod 스키마(`src/core/schema.ts`)로 검사합니다. 모양이 예상과
다르면 아무것도 쓰지 않고 멈춥니다. 예를 들어 Todoist가 `deadline` 필드 이름을 바꾸면, 검사
없이 읽는 코드는 모든 deadline을 빈 값으로 읽고 그대로 지워 버립니다. 그래서 없으면 빈 값으로
읽힐 필드는 키가 반드시 있어야 통과합니다.

한 번에 20개를 넘게 완료하려고 하면 실행을 중단합니다. 그 정도 수량이라면 org 권한이
누락되었거나 page가 잘려서 응답한 상황이지, 실제로 스무 개를 끝냈을 가능성은 낮기
때문입니다. 실제로 그런 경우라면 `--force`를 사용합니다.

state 파일에 없는 항목은 건드리지 않습니다. 따라서 GitHub project 안에 메모를 직접 적어
두어도 안전합니다.

GitHub에서 사라진 항목은 완료 처리합니다. 다만 not planned나 duplicate로 닫힌 issue,
merge 되지 않고 닫힌 PR은 완료가 아니라 삭제합니다. 하지 않기로 한 일을 완료 목록에
남기면 실제로 끝낸 작업과 섞여서 기록이 틀리기 때문입니다. 이 판정은 GraphQL로 issue의
`stateReason`과 PR의 `state`를 확인해서 내립니다. merge 된 PR은 `MERGED`라는 별도
state 이므로 완료로 남습니다.

비어 있는 section이나 sub-project는 곧바로 삭제하지 않고, 처음 비게 된 날짜를 기록해
둡니다. 그 상태로 7일 (`--grace`)이 지나야 삭제합니다. 오늘 issue가 모두 닫힌 repo를
내일 다시 열 수도 있는데, polling 할 때마다 삭제하고 다시 생성하면 곤란하기 때문입니다.
안에 항목이 하나라도 남아 있으면, 이 도구가 만든 항목이 아니더라도 삭제하지 않습니다.

## 마감 임박

Todoist는 deadline만으로는 task를 Today에 띄우지 않습니다. Upcoming에만 보이므로 due가 없는
task는 마감이 지날 때까지 눈에 띄지 않을 수 있습니다. 그래서 deadline이 2일 안으로 다가왔는데
due가 비어 있으면 due를 오늘로 넣습니다. 이미 마감이 지난 task도 포함합니다.

- task마다 한 번만 넣습니다. 올라간 뒤에 due를 손으로 지우면 그 결정을 존중해서 다시
  넣지 않습니다.
- 한 번에 20개를 넘게 올리려 하면 멈춥니다. Today가 넘쳐 버리면 정작 봐야 할 것이 묻히기
  때문입니다. 의도한 상황이면 `--force`를 씁니다.
- 대상은 Todoist 필터 `no date & !no deadline`로 한 번에 읽습니다. 날짜 계산은 서버가 아니라
  이 컴퓨터의 날짜를 기준으로 합니다.

## 상태 저장

기능마다 checkout 루트의 `state/` 아래에 파일 하나씩을 둡니다. 이 디렉터리는 gitignore에
등록되어 있습니다.

| 파일 | 내용 |
| --- | --- |
| `github.json` | GitHub id와 Todoist id의 짝 |
| `recur.json` | 템플릿별로 이미 만든 회차의 마감일과 task id, 보고한 오류 |
| `nudge.json` | Today로 올린 task와 그 날짜. 60일이 지나면 지웁니다 |
| `runs.json` | 기능별 마지막 실행 시각과 결과. `tdx status`가 읽습니다 |
| `config.json` | `tdx disable`로 끈 기능 목록 |

`github.json`을 잃어버리면 다음 실행에서 기존 tree를 인식하지 못하고 동일한 tree를 하나
더 생성합니다. 머신 한 대에서만 실행한다고 가정하고 있습니다. Python 버전이 쓰던 루트의
`state.json`은 처음 실행할 때 `state/github.json`으로 옮기고, 원본은
`state.json.migrated`로 이름을 바꿔 남겨 둡니다.

## 제약

- webhook이 아니라 polling 방식이므로 최대 2분까지 지연됩니다.
- issue 본문과 comment는 가져오지 않고 link만 연결합니다.

## 개발

```bash
mise install        # bun, fnox, hk, pkl
bun install
hk install --mise   # 커밋할 때 검사 (이 레포에만)
mise run check      # 테스트, lint, 타입, 미사용 코드. 네트워크를 사용하지 않음
biome check --write .
```

`mise run check`가 돌리는 네 가지를 pre-commit hook(hk)과 GitHub Actions도 똑같이 돌립니다.

| 검사 | 도구 | 잡는 것 |
| --- | --- | --- |
| 테스트 | `bun test --coverage` | 동작. 파일마다 줄 75%, 함수 70% 아래로 떨어지면 실패합니다 |
| lint, 포맷 | Biome | await 빠진 promise, 빠진 switch case, 경고도 실패로 칩니다 |
| 타입 | tsc | `exactOptionalPropertyTypes` 등 엄격 옵션을 켜 두었습니다 |
| 미사용 코드 | knip | 쓰이지 않는 파일, export, 의존성 |

Todoist에 쓰는 코드는 `tests/fake.ts`의 메모리 위 가짜 Todoist로 검사합니다. 응답은 실제 스키마를
거치므로 가짜가 실제 API와 어긋나면 테스트가 실패합니다. 테스트마다 state 디렉터리를 새로 만들어서
checkout의 `state/`는 건드리지 않습니다.

코드를 고치기 전에 launchd 를 먼저 내립니다.

```bash
tdx uninstall   # 고치기 전
tdx install     # 끝난 뒤
```

launchd 는 이 checkout 의 `src/cli.tsx`를 직접 실행합니다. 그래서 파일을 저장하는 순간부터
120초마다 작성 중인 코드가 실제 Todoist에 적용되고, `--dry-run` 으로 계획을 먼저 확인하려던
절차가 의미를 잃습니다.

명령은 [Pastel](https://github.com/vadimdemedes/pastel)로 짭니다. `src/commands/` 아래 파일
하나가 명령 하나이고(`recur/new.tsx`가 `tdx recur new`), 옵션과 인자는 zod 스키마로 선언합니다.
파싱과 도움말은 그 스키마에서 나옵니다. 명령 본문은 `src/ui/run.tsx`의 `<Run>`이 돌립니다.
작업을 실행하면서 단계를 그리고, 작업이 돌려준 화면을 마지막 프레임으로 남깁니다. 스크롤 뷰어와
폼은 `<AlternateScreen>` 안에서 열려서, 닫으면 터미널이 열기 전 그대로 돌아옵니다.

계산은 순수 함수로, 화면은 그 결과를 받아 그리는 Ink 컴포넌트로 나눠 두었습니다.
`reconcile.ts`가 네트워크 없이 op 목록만 돌려주므로 test가 가볍습니다.

## 문제 해결

```bash
tdx status
tdx gh sync --dry-run   # 실행 계획 확인
gh auth status          # GitHub 인증
td auth status          # Todoist 인증
tail -50 ~/Library/Logs/tdx.log
```

처음부터 다시 만들려면 Todoist의 "GitHub" project와 `state/github.json`을 둘 다 삭제한 뒤에
한 번 실행합니다. 둘 중 하나만 삭제하면 안 됩니다. project만 삭제하면 존재하지 않는
id를 가리키게 되고, `state/github.json`만 삭제하면 tree가 두 개로 늘어나기 때문입니다.

## 라이선스

MIT
