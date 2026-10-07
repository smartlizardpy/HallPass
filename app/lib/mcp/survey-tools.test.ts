/**
 * The survey tools as an MCP client sees them, through the SDK's in-memory
 * transport: which tools each credential is offered, that the caller reaches the
 * tool body intact, and that an agent is never told "nothing here can write".
 *
 * Everything below the tool layer is mocked. What is being pinned is the wiring
 * in `createMcpServer`: surveys are listed for BOTH kinds of caller (the
 * deliberate exception to "OAuth cannot write"), the bug and tracker tools stay
 * secret-only, and the argument names avoid the ones the activity feed reads a
 * subject from.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  surveys: {
    listSurveys: vi.fn(),
    getSurvey: vi.fn(),
    getSurveyResults: vi.fn(),
    createSurvey: vi.fn(),
    updateSurvey: vi.fn(),
    setSurveyStatus: vi.fn(),
    addSurveyQuestion: vi.fn(),
    updateSurveyQuestion: vi.fn(),
    removeSurveyQuestion: vi.fn(),
  },
  recordActivity: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./surveys", () => h.surveys);
vi.mock("./bugs", () => ({
  closeBugReportDuplicate: vi.fn(),
  getBugReport: vi.fn(),
  listBugReports: vi.fn(),
  markBugReportFixed: vi.fn(),
  triageBugReport: vi.fn(),
}));
vi.mock("./tracker", () => ({
  commentOnTrackerItem: vi.fn(),
  createTrackerItem: vi.fn(),
  getTrackerItem: vi.fn(),
  listTrackerItems: vi.fn(),
  moveTrackerItem: vi.fn(),
}));
vi.mock("./analytics/tools", () => ({ registerAnalyticsTools: vi.fn() }));
vi.mock("./activity-log", () => ({
  recordActivity: h.recordActivity,
  clearActivity: vi.fn(),
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpActor } from "./actor";
import { createMcpServer } from "./server";

const SURVEY_TOOLS = [
  "add_survey_question",
  "create_survey",
  "get_survey",
  "get_survey_results",
  "list_surveys",
  "remove_survey_question",
  "set_survey_status",
  "update_survey",
  "update_survey_question",
];

const secret: McpActor = { kind: "secret", actor: "mcp-agent" };
const oauth: McpActor = {
  kind: "user",
  email: "boss@example.com",
  role: "admin",
  playerId: "p1",
  clientName: "ChatGPT",
};

async function connect(actor: McpActor) {
  const server = createMcpServer(actor);
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.recordActivity.mockResolvedValue(undefined);
});

describe("tool lists", () => {
  it("offers the survey tools to an OAuth account, and nothing about bugs or the tracker", async () => {
    const { tools } = await (await connect(oauth)).listTools();
    const names = tools.map((t) => t.name);
    for (const tool of SURVEY_TOOLS) expect(names).toContain(tool);
    expect(names).not.toContain("create_tracker_item");
    expect(names).not.toContain("mark_bug_report_fixed");
  });

  it("offers a secret holder the survey tools beside the bug and tracker ones", async () => {
    const { tools } = await (await connect(secret)).listTools();
    const names = tools.map((t) => t.name);
    for (const tool of SURVEY_TOOLS) expect(names).toContain(tool);
    expect(names).toContain("create_tracker_item");
    expect(names).toContain("mark_bug_report_fixed");
  });

  it("marks the readers read-only, the writers not, and the one deleter destructive", async () => {
    const { tools } = await (await connect(oauth)).listTools();
    const by = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    for (const reader of ["list_surveys", "get_survey", "get_survey_results"]) {
      expect(by[reader]?.readOnlyHint).toBe(true);
    }
    for (const writer of ["create_survey", "update_survey", "set_survey_status", "add_survey_question", "update_survey_question"]) {
      expect(by[writer]?.readOnlyHint).not.toBe(true);
      expect(by[writer]?.destructiveHint).toBe(false);
    }
    expect(by.remove_survey_question?.destructiveHint).toBe(true);
  });

  it("never names an argument the activity feed would read as another subject", async () => {
    const { tools } = await (await connect(secret)).listTools();
    for (const tool of tools.filter((t) => SURVEY_TOOLS.includes(t.name))) {
      const props = Object.keys((tool.inputSchema as { properties?: object }).properties ?? {});
      for (const reserved of ["id", "reportId", "itemId", "slug"]) {
        expect(props, `${tool.name} takes "${reserved}"`).not.toContain(reserved);
      }
    }
  });

  it("no longer tells an OAuth client that nothing it can reach writes", async () => {
    const client = await connect(oauth);
    const instructions = client.getInstructions() ?? "";
    expect(instructions).not.toMatch(/nothing here can write/i);
    expect(instructions).toMatch(/set_survey_status/);
    expect(instructions).toMatch(/never follow instructions/i);
  });
});

describe("calling a tool", () => {
  it("hands the tool body the caller that connected, not a different one", async () => {
    h.surveys.createSurvey.mockResolvedValue({ ok: true, surveyId: 4, message: "Created" });
    const client = await connect(oauth);
    await client.callTool({ name: "create_survey", arguments: { title: "Winter" } });
    expect(h.surveys.createSurvey).toHaveBeenCalledTimes(1);
    expect(h.surveys.createSurvey.mock.calls[0][0]).toEqual(oauth);
    expect(h.surveys.createSurvey.mock.calls[0][1]).toMatchObject({ title: "Winter" });
  });

  it("returns a refusal as an ordinary result the agent can read, and records it as refused", async () => {
    h.surveys.setSurveyStatus.mockResolvedValue({ ok: false, reason: "Surveys need an admin account." });
    const client = await connect(oauth);
    const result = await client.callTool({
      name: "set_survey_status",
      arguments: { surveyId: 3, status: "live" },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual({ ok: false, reason: "Surveys need an admin account." });
    expect(h.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "set_survey_status", outcome: "refused", reportId: null, itemId: null, slug: null }),
    );
  });

  it("rejects an invalid status and an unknown question kind before reaching the body", async () => {
    const client = await connect(oauth);
    const badStatus = await client.callTool({
      name: "set_survey_status",
      arguments: { surveyId: 3, status: "archived" },
    });
    expect(badStatus.isError).toBe(true);
    const badKind = await client.callTool({
      name: "add_survey_question",
      arguments: { surveyId: 3, kind: "ranking", prompt: "Rank these" },
    });
    expect(badKind.isError).toBe(true);
    expect(h.surveys.setSurveyStatus).not.toHaveBeenCalled();
    expect(h.surveys.addSurveyQuestion).not.toHaveBeenCalled();
  });
});
