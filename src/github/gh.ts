// What GitHub currently hands me.

import type { z } from "zod";
import { type Api, Client, type Params } from "../core/http.ts";
import {
  DiscardedNode,
  GithubIssue,
  GithubRepo,
  GithubSearch,
  graphql,
  parse,
  RelationNode,
} from "../core/schema.ts";
import { cliToken } from "../core/token.ts";
import type { Item, Ref } from "./models.ts";

export const BASE_URL = "https://api.github.com";
const PER_PAGE = 100;
const HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

// An issue I opened and nobody took is mine to do, so it belongs here; one taken
// by someone else does not. `no:assignee` draws that line in the query -- the
// assignee:@me half of "mine" already arrives through the REST assigned list.
export const SEARCHES = [
  "is:pr is:open review-requested:@me",
  "is:pr is:open author:@me",
  "is:issue is:open author:@me no:assignee",
];

// GraphQL takes node ids straight, which is all the state file keeps, so nothing
// has to be parsed back out of a task's text to ask about it. 100 is the cap the
// nodes() field enforces.
const NODES_PER_CALL = 100;
// How the two kinds say the work never happened. An issue spells out its reason;
// a PR only closes, and MERGED is the separate state that means it landed, so a
// plain CLOSED is a PR that was given up on.
const DISCARDED_REASONS = new Set(["NOT_PLANNED", "DUPLICATE"]);
const DISCARDED_STATE = "CLOSED";

// GitHub caps a dependency list well below this, so one page is the whole list.
const EDGES_PER_ITEM = 20;
const EDGE = `(first: ${EDGES_PER_ITEM}) { nodes { id number state repository { nameWithOwner } } }`;
const RELATIONS_QUERY = `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Issue { id blockedBy${EDGE} blocking${EDGE} } } }`;
const DISCARDED_QUERY =
  "query($ids: [ID!]!) { nodes(ids: $ids) {" +
  " ... on Issue { id stateReason }" +
  " ... on PullRequest { id state } } }";

export function client(): Client {
  return new Client(BASE_URL, cliToken("GITHUB_TOKEN", ["gh", "auth", "token"]), HEADERS);
}

type Issue = z.output<typeof GithubIssue>;
type Repo = z.output<typeof GithubRepo>;

function toItem(payload: Issue, repo: Repo): Item {
  const due = payload.milestone?.due_on;
  return {
    ghId: payload.node_id,
    isPr: payload.pull_request !== undefined,
    repoId: String(repo.id),
    repoName: repo.name,
    ownerId: String(repo.owner.id),
    ownerLogin: repo.owner.login,
    ownerIsOrg: repo.owner.type === "Organization",
    number: payload.number,
    title: payload.title.split(/\s+/).filter(Boolean).join(" "),
    url: payload.html_url,
    deadline: due ? due.slice(0, 10) : null,
    blockedBy: [],
    blocking: [],
  };
}

async function* pages(api: Api, path: string, params: Params): AsyncGenerator<Issue> {
  for (let page = 1; ; page++) {
    const reply = await api.get(path, { per_page: PER_PAGE, page, ...params });
    const batch = parse(GithubIssue.array(), reply ?? [], `GET ${path}`);
    if (!batch.length) return;
    yield* batch;
    if (batch.length < PER_PAGE) return;
  }
}

// Assigned issues and PRs, plus what I opened or was asked to review.
//
// Archived repos are dropped: their work cannot be acted on, so a task for it
// is noise. The repo stays cached either way, so the skip costs no extra call.
//
// The assigned list comes from the REST issues endpoint rather than search: it
// has no search-index lag, and it embeds the repository and owner ids that the
// whole id-based mapping depends on. Search returns neither, so the few PRs it
// finds get one cached repository lookup each.
export async function desired(api: Api): Promise<Item[]> {
  const items = new Map<string, Item>();
  const repos = new Map<string, Repo>();

  for await (const issue of pages(api, "/issues", { filter: "assigned", state: "open" })) {
    const repo = issue.repository;
    if (!repo) throw new Error(`GET /issues: ${issue.node_id} came without its repository`);
    repos.set(repo.full_name, repo);
    if (repo.archived) continue;
    items.set(issue.node_id, toItem(issue, repo));
  }

  for (const q of SEARCHES) {
    const found = parse(
      GithubSearch,
      await api.get("/search/issues", { q, per_page: PER_PAGE }),
      `search ${q}`,
    );
    for (const payload of found.items) {
      const fullName = (payload.repository_url ?? "").replace(`${BASE_URL}/repos/`, "");
      let repo = repos.get(fullName);
      if (!repo) {
        repo = parse(GithubRepo, await api.get(`/repos/${fullName}`), `GET /repos/${fullName}`);
        repos.set(fullName, repo);
      }
      if (repo.archived) continue;
      items.set(payload.node_id, toItem(payload, repo));
    }
  }

  return [...items.values()];
}

function neverHappened(node: { stateReason?: string | null; state?: string }): boolean {
  return DISCARDED_REASONS.has(node.stateReason ?? "") || node.state === DISCARDED_STATE;
}

async function* nodeBatches<N extends z.ZodType>(
  api: Api,
  query: string,
  node: N,
  ids: string[],
  what: string,
): AsyncGenerator<z.output<N> | null> {
  const reply = graphql(node);
  for (let start = 0; start < ids.length; start += NODES_PER_CALL) {
    const variables = { ids: ids.slice(start, start + NODES_PER_CALL) };
    const body = parse(
      reply,
      await api.post("/graphql", { query, variables }),
      `the ${what} lookup`,
    );
    // An id that no longer resolves -- issue deleted, access lost -- comes
    // back as a null node next to an error, with the rest of the batch intact.
    // That is the ordinary case here, so only a reply carrying no data at all
    // counts as a failure worth stopping the run for.
    if (!body.data) {
      throw new Error(`GitHub GraphQL refused the ${what} lookup: ${JSON.stringify(body.errors)}`);
    }
    yield* body.data.nodes;
  }
}

// Of the ids that fell out of the goal, the ones closed as not-work.
//
// An issue closed as not planned or duplicate, and a PR closed without being
// merged, are work that never happened; completing the Todoist task would file
// a false record of having done it. Every other way an id can vanish -- closed
// as completed, merged, unassigned, repo archived, access lost -- still reads
// as a completion, and an id GitHub no longer serves comes back null and falls
// through to one.
export async function discarded(api: Api, ghIds: Iterable<string>): Promise<Set<string>> {
  const out = new Set<string>();
  for await (const node of nodeBatches(
    api,
    DISCARDED_QUERY,
    DiscardedNode,
    [...ghIds].sort(),
    "node",
  )) {
    if (node && neverHappened(node)) out.add(node.id);
  }
  return out;
}

type Edge = { id: string; number: number; state: string; repository: { nameWithOwner: string } };

function openRefs(nodes: Edge[]): Ref[] {
  // A closed blocker no longer blocks, and a closed dependent no longer waits.
  return nodes
    .filter((n) => n.state === "OPEN")
    .map((n) => ({ ghId: n.id, number: n.number, repo: n.repository.nameWithOwner }));
}

// The same items, carrying their open dependency edges.
//
// Batched through the node lookup `discarded` already uses, so this costs one
// call per hundred issues rather than one per issue. Pull requests carry no
// dependencies, so they are left out of the ask entirely.
export async function relations(api: Api, items: Item[]): Promise<Item[]> {
  const ids = items
    .filter((i) => !i.isPr)
    .map((i) => i.ghId)
    .sort();
  const edges = new Map<string, [Ref[], Ref[]]>();
  for await (const node of nodeBatches(api, RELATIONS_QUERY, RelationNode, ids, "relation")) {
    if (node) edges.set(node.id, [openRefs(node.blockedBy.nodes), openRefs(node.blocking.nodes)]);
  }
  return items.map((item) => {
    const edge = edges.get(item.ghId);
    return edge ? { ...item, blockedBy: edge[0], blocking: edge[1] } : item;
  });
}
