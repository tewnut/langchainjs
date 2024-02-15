/* eslint-disable no-promise-executor-return */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { test } from "@jest/globals";
import { z } from "zod";
import { RunnableLambda } from "../index.js";
import { ChatPromptTemplate } from "../../prompts/chat.js";
import {
  FakeListChatModel,
  FakeRetriever,
  FakeStreamingLLM,
} from "../../utils/testing/index.js";
import {
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
} from "../../messages/index.js";
import { ChatGenerationChunk, GenerationChunk } from "../../outputs.js";
import { DynamicStructuredTool, DynamicTool } from "../../tools.js";
import { Document } from "../../documents/document.js";

function reverse(s: string) {
  // Reverse a string.
  return s.split("").reverse().join("");
}

test("Runnable streamEvents method", async () => {
  const chain = RunnableLambda.from(reverse).withConfig({
    runName: "reverse",
  });

  const events = [];
  for await (const event of chain.streamEvents("hello", { version: "v1" })) {
    events.push(event);
  }
  expect(events).toEqual([
    {
      data: { input: "hello" },
      event: "on_chain_start",
      metadata: {},
      name: "reverse",
      run_id: expect.any(String),
      tags: [],
    },
    {
      data: { chunk: "olleh" },
      event: "on_chain_stream",
      metadata: {},
      name: "reverse",
      run_id: expect.any(String),
      tags: [],
    },
    {
      data: { output: "olleh" },
      event: "on_chain_end",
      metadata: {},
      name: "reverse",
      run_id: expect.any(String),
      tags: [],
    },
  ]);
});

test("Runnable streamEvents method with three runnables", async () => {
  const r = RunnableLambda.from(reverse);

  const chain = r
    .withConfig({ runName: "1" })
    .pipe(r.withConfig({ runName: "2" }))
    .pipe(r.withConfig({ runName: "3" }));

  const events = [];
  for await (const event of chain.streamEvents("hello", { version: "v1" })) {
    events.push(event);
  }
  expect(events).toEqual([
    {
      data: { input: "hello" },
      event: "on_chain_start",
      metadata: {},
      name: "RunnableSequence",
      run_id: expect.any(String),
      tags: [],
    },
    {
      data: {},
      event: "on_chain_start",
      metadata: {},
      name: "1",
      run_id: expect.any(String),
      tags: ["seq:step:1"],
    },
    {
      data: { chunk: "olleh" },
      event: "on_chain_stream",
      metadata: {},
      name: "1",
      run_id: expect.any(String),
      tags: ["seq:step:1"],
    },
    {
      data: {},
      event: "on_chain_start",
      metadata: {},
      name: "2",
      run_id: expect.any(String),
      tags: ["seq:step:2"],
    },
    {
      data: { input: "hello", output: "olleh" },
      event: "on_chain_end",
      metadata: {},
      name: "1",
      run_id: expect.any(String),
      tags: ["seq:step:1"],
    },
    {
      data: { chunk: "hello" },
      event: "on_chain_stream",
      metadata: {},
      name: "2",
      run_id: expect.any(String),
      tags: ["seq:step:2"],
    },
    {
      data: {},
      event: "on_chain_start",
      metadata: {},
      name: "3",
      run_id: expect.any(String),
      tags: ["seq:step:3"],
    },
    {
      data: { input: "olleh", output: "hello" },
      event: "on_chain_end",
      metadata: {},
      name: "2",
      run_id: expect.any(String),
      tags: ["seq:step:2"],
    },
    {
      data: { chunk: "olleh" },
      event: "on_chain_stream",
      metadata: {},
      name: "3",
      run_id: expect.any(String),
      tags: ["seq:step:3"],
    },
    {
      data: { chunk: "olleh" },
      event: "on_chain_stream",
      metadata: {},
      name: "RunnableSequence",
      run_id: expect.any(String),
      tags: [],
    },
    {
      data: { input: "hello", output: "olleh" },
      event: "on_chain_end",
      metadata: {},
      name: "3",
      run_id: expect.any(String),
      tags: ["seq:step:3"],
    },
    {
      data: { output: "olleh" },
      event: "on_chain_end",
      metadata: {},
      name: "RunnableSequence",
      run_id: expect.any(String),
      tags: [],
    },
  ]);
});

test("Runnable streamEvents method with three runnables with filtering", async () => {
  const r = RunnableLambda.from(reverse);

  const chain = r
    .withConfig({ runName: "1" })
    .pipe(r.withConfig({ runName: "2", tags: ["my_tag"] }))
    .pipe(r.withConfig({ runName: "3", tags: ["my_tag"] }));

  const events = [];
  for await (const event of chain.streamEvents(
    "hello",
    { version: "v1" },
    {
      includeNames: ["1"],
    }
  )) {
    events.push(event);
  }
  expect(events).toEqual([
    {
      data: {},
      event: "on_chain_start",
      metadata: {},
      name: "1",
      run_id: expect.any(String),
      tags: ["seq:step:1"],
    },
    {
      data: { chunk: "olleh" },
      event: "on_chain_stream",
      metadata: {},
      name: "1",
      run_id: expect.any(String),
      tags: ["seq:step:1"],
    },
    {
      data: { input: "hello", output: "olleh" },
      event: "on_chain_end",
      metadata: {},
      name: "1",
      run_id: expect.any(String),
      tags: ["seq:step:1"],
    },
  ]);
  const events2 = [];
  for await (const event of chain.streamEvents(
    "hello",
    { version: "v1" },
    {
      excludeNames: ["2"],
      includeTags: ["my_tag"],
    }
  )) {
    events2.push(event);
  }
  expect(events2).toEqual([
    {
      data: {},
      event: "on_chain_start",
      metadata: {},
      name: "3",
      run_id: expect.any(String),
      tags: expect.arrayContaining(["seq:step:3", "my_tag"]),
    },
    {
      data: { chunk: "olleh" },
      event: "on_chain_stream",
      metadata: {},
      name: "3",
      run_id: expect.any(String),
      tags: expect.arrayContaining(["seq:step:3", "my_tag"]),
    },
    {
      data: { input: "hello", output: "olleh" },
      event: "on_chain_end",
      metadata: {},
      name: "3",
      run_id: expect.any(String),
      tags: expect.arrayContaining(["seq:step:3", "my_tag"]),
    },
  ]);
});

test("Runnable streamEvents method with llm", async () => {
  const model = new FakeStreamingLLM({
    responses: ["hey!"],
  }).withConfig({
    metadata: { a: "b" },
    tags: ["my_model"],
    runName: "my_model",
  });
  const events = [];
  for await (const event of model.streamEvents("hello", { version: "v1" })) {
    events.push(event);
  }
  expect(events).toEqual([
    {
      event: "on_llm_start",
      name: "my_model",
      run_id: expect.any(String),
      tags: expect.arrayContaining(["my_model"]),
      metadata: {
        a: "b",
      },
      data: {
        input: "hello",
      },
    },
    {
      event: "on_llm_stream",
      run_id: expect.any(String),
      tags: expect.arrayContaining(["my_model"]),
      metadata: {
        a: "b",
      },
      name: "my_model",
      data: { chunk: "h" },
    },

    {
      event: "on_llm_stream",
      run_id: expect.any(String),
      tags: expect.arrayContaining(["my_model"]),
      metadata: {
        a: "b",
      },
      name: "my_model",
      data: { chunk: "e" },
    },
    {
      event: "on_llm_stream",
      run_id: expect.any(String),
      tags: expect.arrayContaining(["my_model"]),
      metadata: {
        a: "b",
      },
      name: "my_model",
      data: { chunk: "y" },
    },
    {
      event: "on_llm_stream",
      run_id: expect.any(String),
      tags: expect.arrayContaining(["my_model"]),
      metadata: {
        a: "b",
      },
      name: "my_model",
      data: { chunk: "!" },
    },
    {
      event: "on_llm_end",
      name: "my_model",
      run_id: expect.any(String),
      tags: expect.arrayContaining(["my_model"]),
      metadata: {
        a: "b",
      },
      data: {
        output: {
          generations: [
            [
              new GenerationChunk({
                generationInfo: {},
                text: "hey!",
              }),
            ],
          ],
        },
      },
    },
  ]);
});

test("Runnable streamEvents method with chat model chain", async () => {
  const template = ChatPromptTemplate.fromMessages([
    ["system", "You are Godzilla"],
    ["human", "{question}"],
  ]).withConfig({
    runName: "my_template",
    tags: ["my_template"],
  });
  const model = new FakeListChatModel({
    responses: ["ROAR"],
  }).withConfig({
    metadata: { a: "b" },
    tags: ["my_model"],
    runName: "my_model",
  });
  const chain = template.pipe(model).withConfig({
    metadata: { foo: "bar" },
    tags: ["my_chain"],
    runName: "my_chain",
  });
  const events = [];
  for await (const event of chain.streamEvents(
    { question: "hello" },
    { version: "v1" }
  )) {
    events.push(event);
  }
  expect(events).toEqual([
    {
      run_id: expect.any(String),
      event: "on_chain_start",
      name: "my_chain",
      tags: ["my_chain"],
      metadata: {
        foo: "bar",
      },
      data: {
        input: {
          question: "hello",
        },
      },
    },
    {
      data: { input: { question: "hello" } },
      event: "on_prompt_start",
      metadata: { foo: "bar" },
      name: "my_template",
      run_id: expect.any(String),
      tags: expect.arrayContaining(["my_chain", "seq:step:1", "my_template"]),
    },
    {
      event: "on_prompt_end",
      name: "my_template",
      run_id: expect.any(String),
      tags: expect.arrayContaining(["seq:step:1", "my_template", "my_chain"]),
      metadata: {
        foo: "bar",
      },
      data: {
        input: {
          question: "hello",
        },
        output: await template.invoke({ question: "hello" }),
      },
    },
    {
      event: "on_llm_start",
      name: "my_model",
      run_id: expect.any(String),
      tags: expect.arrayContaining(["seq:step:2", "my_model", "my_chain"]),
      metadata: {
        foo: "bar",
        a: "b",
      },
      data: {
        input: {
          messages: [
            [new SystemMessage("You are Godzilla"), new HumanMessage("hello")],
          ],
        },
      },
    },
    {
      event: "on_llm_stream",
      run_id: expect.any(String),
      tags: expect.arrayContaining(["my_chain", "my_model", "seq:step:2"]),
      metadata: {
        a: "b",
        foo: "bar",
      },
      name: "my_model",
      data: { chunk: new AIMessageChunk("R") },
    },
    {
      event: "on_chain_stream",
      run_id: expect.any(String),
      tags: ["my_chain"],
      metadata: {
        foo: "bar",
      },
      name: "my_chain",
      data: { chunk: new AIMessageChunk("R") },
    },
    {
      event: "on_llm_stream",
      run_id: expect.any(String),
      tags: expect.arrayContaining(["my_chain", "my_model", "seq:step:2"]),
      metadata: {
        a: "b",
        foo: "bar",
      },
      name: "my_model",
      data: { chunk: new AIMessageChunk("O") },
    },
    {
      event: "on_chain_stream",
      run_id: expect.any(String),
      tags: ["my_chain"],
      metadata: {
        foo: "bar",
      },
      name: "my_chain",
      data: { chunk: new AIMessageChunk("O") },
    },
    {
      event: "on_llm_stream",
      run_id: expect.any(String),
      tags: expect.arrayContaining(["my_chain", "my_model", "seq:step:2"]),
      metadata: {
        a: "b",
        foo: "bar",
      },
      name: "my_model",
      data: { chunk: new AIMessageChunk("A") },
    },
    {
      event: "on_chain_stream",
      run_id: expect.any(String),
      tags: ["my_chain"],
      metadata: {
        foo: "bar",
      },
      name: "my_chain",
      data: { chunk: new AIMessageChunk("A") },
    },
    {
      event: "on_llm_stream",
      run_id: expect.any(String),
      tags: expect.arrayContaining(["my_chain", "my_model", "seq:step:2"]),
      metadata: {
        a: "b",
        foo: "bar",
      },
      name: "my_model",
      data: { chunk: new AIMessageChunk("R") },
    },
    {
      event: "on_chain_stream",
      run_id: expect.any(String),
      tags: ["my_chain"],
      metadata: {
        foo: "bar",
      },
      name: "my_chain",
      data: { chunk: new AIMessageChunk("R") },
    },
    {
      event: "on_llm_end",
      name: "my_model",
      run_id: expect.any(String),
      tags: expect.arrayContaining(["seq:step:2", "my_model", "my_chain"]),
      metadata: {
        foo: "bar",
        a: "b",
      },
      data: {
        input: {
          messages: [
            [new SystemMessage("You are Godzilla"), new HumanMessage("hello")],
          ],
        },
        output: {
          generations: [
            [
              new ChatGenerationChunk({
                generationInfo: {},
                message: new AIMessageChunk("ROAR"),
                text: "ROAR",
              }),
            ],
          ],
        },
      },
    },
    {
      event: "on_chain_end",
      name: "my_chain",
      run_id: expect.any(String),
      tags: ["my_chain"],
      metadata: {
        foo: "bar",
      },
      data: {
        output: new AIMessageChunk("ROAR"),
      },
    },
  ]);
});

test("Runnable streamEvents method with simple tools", async () => {
  const tool = new DynamicTool({
    func: async () => "hello",
    name: "parameterless",
    description: "A tool that does nothing",
  });
  const events = [];
  for await (const event of tool.streamEvents({}, { version: "v1" })) {
    events.push(event);
  }

  expect(events).toEqual([
    {
      data: { input: {} },
      event: "on_tool_start",
      metadata: {},
      name: "parameterless",
      run_id: expect.any(String),
      tags: [],
    },
    {
      data: { chunk: "hello" },
      event: "on_tool_stream",
      metadata: {},
      name: "parameterless",
      run_id: expect.any(String),
      tags: [],
    },
    {
      data: { output: "hello" },
      event: "on_tool_end",
      metadata: {},
      name: "parameterless",
      run_id: expect.any(String),
      tags: [],
    },
  ]);

  const toolWithParams = new DynamicStructuredTool({
    func: async (params: { x: number; y: string }) =>
      JSON.stringify({ x: params.x, y: params.y }),
    schema: z.object({
      x: z.number(),
      y: z.string(),
    }),
    name: "with_parameters",
    description: "A tool that does nothing",
  });
  const events2 = [];
  for await (const event of toolWithParams.streamEvents(
    { x: 1, y: "2" },
    { version: "v1" }
  )) {
    events2.push(event);
  }
  expect(events2).toEqual([
    {
      data: { input: { x: 1, y: "2" } },
      event: "on_tool_start",
      metadata: {},
      name: "with_parameters",
      run_id: expect.any(String),
      tags: [],
    },
    {
      data: { chunk: JSON.stringify({ x: 1, y: "2" }) },
      event: "on_tool_stream",
      metadata: {},
      name: "with_parameters",
      run_id: expect.any(String),
      tags: [],
    },
    {
      data: { output: JSON.stringify({ x: 1, y: "2" }) },
      event: "on_tool_end",
      metadata: {},
      name: "with_parameters",
      run_id: expect.any(String),
      tags: [],
    },
  ]);
});

test("Runnable streamEvents method with a retriever", async () => {
  const retriever = new FakeRetriever({
    output: [
      new Document({ pageContent: "hello world!", metadata: { foo: "bar" } }),
      new Document({
        pageContent: "goodbye world!",
        metadata: { food: "spare" },
      }),
    ],
  });
  const events = [];
  for await (const event of retriever.streamEvents("hello", {
    version: "v1",
  })) {
    events.push(event);
  }
  expect(events).toEqual([
    {
      data: {
        input: "hello",
      },
      event: "on_retriever_start",
      metadata: {},
      name: "FakeRetriever",
      run_id: expect.any(String),
      tags: [],
    },
    {
      data: {
        chunk: [
          new Document({
            pageContent: "hello world!",
            metadata: { foo: "bar" },
          }),
          new Document({
            pageContent: "goodbye world!",
            metadata: { food: "spare" },
          }),
        ],
      },
      event: "on_retriever_stream",
      metadata: {},
      name: "FakeRetriever",
      run_id: expect.any(String),
      tags: [],
    },
    {
      data: {
        output: {
          documents: [
            new Document({
              pageContent: "hello world!",
              metadata: { foo: "bar" },
            }),
            new Document({
              pageContent: "goodbye world!",
              metadata: { food: "spare" },
            }),
          ],
        },
      },
      event: "on_retriever_end",
      metadata: {},
      name: "FakeRetriever",
      run_id: expect.any(String),
      tags: [],
    },
  ]);
});
