// Ported from src/termaid/parser/gitgraph.py.

import { MAIN_BRANCH, makeGitGraph, type Commit, type CommitType, type GitGraph } from "../model/gitgraph.ts";
import { pyRepr as repr, pyStrip, stripChars } from "../pycompat.ts";
import { DIRECTIVE } from "../utils.ts";

const COMMENT = "%%";
const HEADER = "gitGraph";
const DIRECTION_RE = /^(LR|TB|BT)\s*:?/i;
const DIRECTIVE_GLOBAL_RE = new RegExp(DIRECTIVE, "g");
const INIT_RE = /%%\{\s*init:\s*(\{[\s\S]*\})\s*\}%%/;
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f-\x9f]/g;

const COMMIT = "commit";
const BRANCH = "branch ";
const CHECKOUT = "checkout ";
const SWITCH = "switch ";
const MERGE = "merge ";
const CHERRY_PICK = "cherry-pick";
const RESET = "reset ";

const ID_RE = /id:\s*"([^"]*)"/;
const TYPE_RE = /type:\s*(NORMAL|REVERSE|HIGHLIGHT)/;
const TAG_RE = /tag:\s*"([^"]*)"/;
const BRANCH_RE = /^branch\s+"?([^"]+?)"?\s*(?:order:\s*(\d+))?\s*$/;
const MERGE_RE = /^merge\s+"?([^"]+?)"?(?:\s|$)/;
const RESET_RE = /^reset\s+"?([^"~]+?)"?\s*(?:~(\d+))?\s*$/;

const QUOTE = '"';
const CHERRY_SUFFIX = "-cherry";
const CHERRY_RETRY = "-cp";
const NO_ORDER = -1;
const DEFAULT_TYPE: CommitType = "NORMAL";

const generatedId = (name: string | number): string => `"${name}"`;

/** A mermaid gitGraph definition. */
export function parseGitGraph(text: string): GitGraph {
  return new GitGraphParser(text).parse();
}

class GitGraphParser {
  private diagram = makeGitGraph();
  private currentBranch = MAIN_BRANCH;
  private heads = new Map<string, string>();
  private autoId = 0;
  private byId = new Map<string, Commit>();
  private branchNames = new Set<string>();
  private seq = 0;
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  parse(): GitGraph {
    for (const m of this.text.matchAll(DIRECTIVE_GLOBAL_RE)) {
      this.parseInit(m[0]);
    }
    const remaining = this.preprocess(this.text.replace(DIRECTIVE_GLOBAL_RE, ""));
    if (remaining.length === 0) return this.diagram;

    const header = remaining[0] as string;
    let body = remaining;
    if (header.startsWith(HEADER)) {
      const direction = DIRECTION_RE.exec(pyStrip(header.slice(HEADER.length)));
      if (direction !== null) this.diagram.direction = (direction[1] as string).toUpperCase();
      body = remaining.slice(1);
    }

    this.currentBranch = this.diagram.mainBranchName;
    this.ensureBranch(this.currentBranch);
    for (const line of body) this.parseLine(line);
    return this.diagram;
  }

  private preprocess(text: string): string[] {
    const result: string[] = [];
    for (const line of text.split("\n")) {
      const stripped = pyStrip(line);
      if (stripped.startsWith(COMMENT)) continue;
      if (stripped !== "") result.push(stripped);
    }
    return result;
  }

  private parseInit(directiveText: string): void {
    const directive = INIT_RE.exec(directiveText);
    if (directive === null) return;
    const written = directive[1] as string;

    let config: unknown;
    try {
      config = JSON.parse(written);
    } catch {
      try {
        config = JSON.parse(written.replaceAll("'", QUOTE));
      } catch {
        return;
      }
    }

    if (typeof config !== "object" || config === null || Array.isArray(config)) return;
    const record = config as Record<string, unknown>;
    const git = record[HEADER] !== undefined ? record[HEADER] : record;
    if (typeof git !== "object" || git === null || Array.isArray(git)) return;
    const gitRecord = git as Record<string, unknown>;
    if ("mainBranchName" in gitRecord && gitRecord["mainBranchName"] !== undefined) {
      const rawName = pyValueStr(gitRecord["mainBranchName"]);
      this.diagram.mainBranchName = rawName.replace(CONTROL_CHARS_RE, "");
    }
  }

  private parseLine(line: string): void {
    if (line.startsWith(COMMIT)) return this.parseCommit(line);
    if (line.startsWith(BRANCH)) return this.parseBranch(line);

    if (line.startsWith(CHECKOUT) || line.startsWith(SWITCH)) {
      const rest = pyStrip(line.slice(line.search(/\s/)));
      if (rest !== "") {
        const name = stripChars(pyStrip(rest), QUOTE);
        if (this.branchNames.has(name)) this.currentBranch = name;
        else this.diagram.warnings.push(`Checkout non-existent branch: ${repr(name)}`);
      }
      return;
    }

    if (line.startsWith(MERGE)) return this.parseMerge(line);
    if (line.startsWith(CHERRY_PICK)) return this.parseCherryPick(line);
    if (line.startsWith(RESET)) return this.parseReset(line);

    this.diagram.warnings.push(`Unrecognized line: ${repr(line)}`);
  }

  private attributes(line: string): { id: string | null; type: CommitType; tag: string } {
    const id = ID_RE.exec(line);
    const type = TYPE_RE.exec(line);
    const tag = TAG_RE.exec(line);
    return {
      id: id === null ? null : (id[1] as string),
      type: type === null ? DEFAULT_TYPE : ((type[1] as string) as CommitType),
      tag: tag === null ? "" : (tag[1] as string),
    };
  }

  private record(id: string, label: string, type: CommitType, tag: string, parents: string[]): void {
    const commit: Commit = { id, branch: this.currentBranch, label, type, tag, parents, seq: this.seq };
    this.seq += 1;
    this.diagram.commits.push(commit);
    this.byId.set(id, commit);
    this.heads.set(this.currentBranch, id);
  }

  private parentsOfHead(): string[] {
    const head = this.heads.get(this.currentBranch);
    return head === undefined ? [] : [head];
  }

  private parseCommit(line: string): void {
    const { id, type, tag } = this.attributes(line);
    let commitId: string;
    let label: string;
    if (id === null) {
      label = String(this.autoId);
      commitId = generatedId(label);
      this.autoId += 1;
    } else {
      commitId = id;
      label = id;
    }
    this.record(commitId, label, type, tag, this.parentsOfHead());
  }

  private parseBranch(line: string): void {
    const branch = BRANCH_RE.exec(line);
    if (branch === null) return;
    const name = pyStrip(branch[1] as string);
    const order = branch[2] === undefined ? NO_ORDER : Number.parseInt(branch[2], 10);

    this.ensureBranch(name, order, this.heads.get(this.currentBranch) ?? "");

    const head = this.heads.get(this.currentBranch);
    if (head !== undefined) this.heads.set(name, head);
    this.currentBranch = name;
  }

  private parseMerge(line: string): void {
    const merge = MERGE_RE.exec(line);
    if (merge === null) return;
    const merged = pyStrip(merge[1] as string);

    const { id, type, tag } = this.attributes(line);
    let commitId: string;
    let label: string;
    if (id === null) {
      commitId = generatedId(this.autoId);
      this.autoId += 1;
      label = "";
    } else {
      commitId = id;
      label = id;
    }
    const parents = this.parentsOfHead();
    const other = this.heads.get(merged);
    if (other !== undefined) parents.push(other);

    this.record(commitId, label, type, tag, parents);
  }

  private parseCherryPick(line: string): void {
    const source = ID_RE.exec(line);
    if (source === null) return;
    const sourceId = source[1] as string;

    if (!this.byId.has(sourceId)) {
      this.diagram.warnings.push(`Cherry-pick non-existent commit: ${repr(sourceId)}`);
      return;
    }

    let label = `${sourceId}${CHERRY_SUFFIX}`;
    while (this.byId.has(generatedId(label))) label += CHERRY_RETRY;
    const commitId = generatedId(label);

    const tag = TAG_RE.exec(line);
    const parents = this.parentsOfHead();
    parents.push(sourceId);
    this.record(commitId, label, DEFAULT_TYPE, tag === null ? "" : (tag[1] as string), parents);
  }

  private parseReset(line: string): void {
    const reset = RESET_RE.exec(line);
    if (reset === null) return;
    const ref = pyStrip(reset[1] as string);
    const back = reset[2] === undefined ? 0 : Number.parseInt(reset[2], 10);

    let id = this.heads.get(ref);
    if (id === undefined) {
      if (!this.byId.has(ref)) {
        this.diagram.warnings.push(`Reset to unknown ref: ${repr(ref)}`);
        return;
      }
      id = ref;
    }

    for (let i = 0; i < back; i++) {
      const commit = this.byId.get(id as string);
      const parent = commit?.parents[0];
      if (parent === undefined) {
        this.diagram.warnings.push(`Cannot walk back ${back} ancestors from ${repr(ref)}`);
        return;
      }
      id = parent;
    }

    this.heads.set(this.currentBranch, id as string);
  }

  private ensureBranch(name: string, order: number = NO_ORDER, startCommit = ""): void {
    if (this.branchNames.has(name)) return;
    this.branchNames.add(name);
    this.diagram.branches.push({ name, order, startCommit });
  }
}

function pyValueStr(val: unknown): string {
  if (val === null) return "None";
  if (val === true) return "True";
  if (val === false) return "False";
  return String(val);
}
