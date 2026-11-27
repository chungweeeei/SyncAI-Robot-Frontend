import { describe, expect, it } from "vitest";

import { RECORDING_TOPICS, recordingTopics, topicsToSend } from "@/lib/recording/topics";

describe("RECORDING_TOPICS", () => {
  it.each(Object.entries(RECORDING_TOPICS))(
    "%s defaults only to channels it offers, each offered once",
    (_, set) => {
      const offered = set.presets.map((preset) => preset.topic);
      expect(new Set(offered).size).toBe(offered.length);
      for (const topic of set.defaults) expect(offered).toContain(topic);
      expect(set.defaults.length).toBeGreaterThan(0);
    },
  );
});

describe("recordingTopics", () => {
  it("offers nothing while the model is unknown, rather than another model's channels", () => {
    expect(recordingTopics(null)).toBeNull();
    expect(recordingTopics(undefined)).toBeNull();
    expect(recordingTopics("m20")).toBe(RECORDING_TOPICS.m20);
  });
});

describe("topicsToSend", () => {
  const set = {
    presets: [
      { topic: "a", hint: "" },
      { topic: "b", hint: "" },
    ],
    defaults: ["a"],
  };

  it("sends the model's defaults until the operator chooses", () => {
    expect(topicsToSend(set, null)).toEqual(["a"]);
  });

  it("sends the operator's choice, an empty one included", () => {
    expect(topicsToSend(set, ["b", "a"])).toEqual(["b", "a"]);
    expect(topicsToSend(set, [])).toEqual([]);
  });

  it("drops a channel the robot's model does not offer", () => {
    expect(topicsToSend(set, ["a", "gone"])).toEqual(["a"]);
  });
});
