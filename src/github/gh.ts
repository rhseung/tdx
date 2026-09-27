// What GitHub currently hands me.

import { type Api, Client, type Json, type Params } from "../core/http.ts";
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

function toItem(payload: Json, repo: Json, isPr: boolean): Item {
  const owner = repo.owner;
  const due: string | undefined = payload.milestone?.due_on ?? undefined;
  return {
    ghId: payload.node_id,
    isPr,
    repoId: String(repo.id),
    repoName: repo.name,
    ownerId: String(owner.id),
    ownerLogin: owner.login,
    ownerIsOrg: owner.type === "Organization",
    number: payload.number,
    title: String(payload.title).split(/\s+/).filter(Boolean).join(" "),
    url: payload.html_url,
    deadline: due ? due.slice(0, 10) : null,
    blockedBy: [],
    blocking: [],
  };
}

async function* pages(api: Api, path: string, params: Params): AsyncGenerator<Json> {
  for (let page = 1; ; page++) {
    const batch: Json[] = await api.get(path, { per_page: PER_PAGE, page, ...params });
    if (!batch?.length) return;
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
  const repos = new Map<string, Json>();

  for await (const issue of pages(api, "/issues", { filter: "assigned", state: "open" })) {
    const repo = issue.repository;
    repos.set(repo.full_name, repo);
    if (repo.archived) continue;
    items.set(issue.node_id, toItem(issue, repo, "pull_request" in issue));
  }

  for (const q of SEARCHES) {
    const found = await api.get("/search/issues", { q, per_page: PER_PAGE });
    for (const payload of found.items) {
      const fullName = String(payload.repository_url).replace(`${BASE_URL}/repos/`, "");
      if (!repos.has(fullName)) repos.set(fullName, await api.get(`/repos/${fullName}`));
      const repo = repos.get(fullName);
      if (repo.archived) continue;
      items.set(payload.node_id, toItem(payload, repo, "pull_request" in payload));
    }
  }

  return [...items.values()];
}

function neverHappened(node: Json): boolean {
  return DISCARDED_REASONS.has(node.stateReason) || node.state === DISCARDED_STATE;
}

async function* nodeBatches(api: Api, query: string, ids: string[], what: string) {
  for (let start = 0; start < ids.length; start += NODES_PER_CALL) {
    const body = await api.post("/graphql", {
      query,
      variables: { ids: ids.slice(start, start + NODES_PER_CALL) },
    });
    // An id that no longer resolves -- issue deleted, access lost -- comes
    // back as a null node next to an error, with the rest of the batch intact.
    // That is the ordinary case here, so only a reply carrying no data at all
    // counts as a failure worth stopping the run for.
    if (body?.data == null) {
      throw new Error(`GitHub GraphQL refused the ${what} lookup: ${JSON.stringify(body?.errors)}`);
    }
    yield* body.data.nodes as Json[];
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
  for await (const node of nodeBatches(api, DISCARDED_QUERY, [...ghIds].sort(), "node")) {
    if (node && neverHappened(node)) out.add(node.id);
  }
  return out;
}

function openRefs(nodes: Json[]): Ref[] {
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
  for await (const node of nodeBatches(api, RELATIONS_QUERY, ids, "relation")) {
    if (node) edges.set(node.id, [openRefs(node.blockedBy.nodes), openRefs(node.blocking.nodes)]);
  }
  return items.map((item) => {
    const edge = edges.get(item.ghId);
    return edge ? { ...item, blockedBy: edge[0], blocking: edge[1] } : item;
  });
}
