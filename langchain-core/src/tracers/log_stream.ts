import {
  applyPatch,
  type Operation as JSONPatchOperation,
} from "../utils/fast-json-patch/index.js";
import { BaseTracer, type Run } from "./base.js";
import {
  BaseCallbackHandlerInput,
  HandleLLMNewTokenCallbackFields,
} from "../callbacks/base.js";
import { IterableReadableStream } from "../utils/stream.js";
import { ChatGenerationChunk, GenerationChunk } from "../outputs.js";
import { AIMessageChunk } from "../messages/index.js";

/**
 * Interface that represents the structure of a log entry in the
 * `LogStreamCallbackHandler`.
 */
export type LogEntry = {
  /** ID of the sub-run. */
  id: string;
  /** Name of the object being run. */
  name: string;
  /** Type of the object being run, eg. prompt, chain, llm, etc. */
  type: string;
  /** List of tags for the run. */
  tags: string[];
  /** Key-value pairs of metadata for the run. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any>;
  /** ISO-8601 timestamp of when the run started. */
  start_time: string;
  /** List of general output chunks streamed by this run. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  streamed_output: any[];
  /** List of LLM tokens streamed by this run, if applicable. */
  streamed_output_str: string[];
  /** Inputs to this run. Not available currently via streamLog. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputs?: any;
  /** Final output of this run. Only available after the run has finished successfully. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  final_output?: any;
  /** ISO-8601 timestamp of when the run ended. Only available after the run has finished. */
  end_time?: string;
};

export type RunState = {
  /** ID of the sub-run. */
  id: string;
  /** List of output chunks streamed by Runnable.stream() */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  streamed_output: any[];
  /** Final output of the run, usually the result of aggregating streamed_output. Only available after the run has finished successfully. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  final_output?: any;
  /**
   * List of sub-runs contained in this run, if any, in the order they were started.
   * If filters were supplied, this list will contain only the runs that matched the filters.
   */
  logs: Record<string, LogEntry>;
  /** Name of the object being run. */
  name: string;
  /** Type of the object being run, eg. prompt, chain, llm, etc. */
  type: string;
};

/**
 * List of jsonpatch JSONPatchOperations, which describe how to create the run state
 * from an empty dict. This is the minimal representation of the log, designed to
 * be serialized as JSON and sent over the wire to reconstruct the log on the other
 * side. Reconstruction of the state can be done with any jsonpatch-compliant library,
 * see https://jsonpatch.com for more information.
 */
export class RunLogPatch {
  ops: JSONPatchOperation[];

  constructor(fields: { ops?: JSONPatchOperation[] }) {
    this.ops = fields.ops ?? [];
  }

  concat(other: RunLogPatch) {
    const ops = this.ops.concat(other.ops);
    const states = applyPatch({}, ops);
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    return new RunLog({
      ops,
      state: states[states.length - 1].newDocument as RunState,
    });
  }
}

export class RunLog extends RunLogPatch {
  state: RunState;

  constructor(fields: { ops?: JSONPatchOperation[]; state: RunState }) {
    super(fields);
    this.state = fields.state;
  }

  concat(other: RunLogPatch) {
    const ops = this.ops.concat(other.ops);
    const states = applyPatch(this.state, other.ops);
    return new RunLog({ ops, state: states[states.length - 1].newDocument });
  }

  static fromRunLogPatch(patch: RunLogPatch) {
    const states = applyPatch({}, patch.ops);
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    return new RunLog({
      ops: patch.ops,
      state: states[states.length - 1].newDocument as RunState,
    });
  }
}

/**
 * Data associated with a StreamEvent.
 */
export type StreamEventData = {
  /**
   * The input passed to the runnable that generated the event.
   * Inputs will sometimes be available at the *START* of the runnable, and
   * sometimes at the *END* of the runnable.
   * If a runnable is able to stream its inputs, then its input by definition
   * won't be known until the *END* of the runnable when it has finished streaming
   * its inputs.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input?: any;

  /**
   * The output of the runnable that generated the event.
   * Outputs will only be available at the *END* of the runnable.
   * For most runnables, this field can be inferred from the `chunk` field,
   * though there might be some exceptions for special cased runnables (e.g., like
   * chat models), which may return more information.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output?: any;

  /**
   * A streaming chunk from the output that generated the event.
   * chunks support addition in general, and adding them up should result
   * in the output of the runnable that generated the event.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chunk?: any;
};

/**
 * A streaming event.
 *
 * Schema of a streaming event which is produced from the streamEvents method.
 */
export type StreamEvent = {
  /**
   * Event names are of the format: on_[runnable_type]_(start|stream|end).
   *
   * Runnable types are one of:
   * - llm - used by non chat models
   * - chat_model - used by chat models
   * - prompt --  e.g., ChatPromptTemplate
   * - tool -- from tools defined via @tool decorator or inheriting from Tool/BaseTool
   * - chain - most Runnables are of this type
   *
   * Further, the events are categorized as one of:
   * - start - when the runnable starts
   * - stream - when the runnable is streaming
   * - end - when the runnable ends
   *
   * start, stream and end are associated with slightly different `data` payload.
   *
   * Please see the documentation for `EventData` for more details.
   */
  event: string;
  /** The name of the runnable that generated the event. */
  name: string;
  /**
   * An randomly generated ID to keep track of the execution of the given runnable.
   *
   * Each child runnable that gets invoked as part of the execution of a parent runnable
   * is assigned its own unique ID.
   */
  run_id: string;
  /**
   * Tags associated with the runnable that generated this event.
   * Tags are always inherited from parent runnables.
   */
  tags?: string[];
  /** Metadata associated with the runnable that generated this event. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any>;
  /**
   * Event data.
   *
   * The contents of the event data depend on the event type.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: StreamEventData;
};

export type SchemaFormat = "original" | "streaming_events";

export interface LogStreamCallbackHandlerInput
  extends BaseCallbackHandlerInput {
  autoClose?: boolean;
  includeNames?: string[];
  includeTypes?: string[];
  includeTags?: string[];
  excludeNames?: string[];
  excludeTypes?: string[];
  excludeTags?: string[];
  _schemaFormat?: SchemaFormat;
}

/**
 * Extract standardized inputs from a run.
 *
 * Standardizes the inputs based on the type of the runnable used.
 *
 * @param run - Run object
 * @param schemaFormat - The schema format to use.
 *
 * @returns Valid inputs are only dict. By conventions, inputs always represented
 * invocation using named arguments.
 * A null means that the input is not yet known!
 */
async function _getStandardizedInputs(run: Run, schemaFormat: SchemaFormat) {
  if (schemaFormat === "original") {
    throw new Error(
      "Do not assign inputs with original schema drop the key for now. " +
        "When inputs are added to streamLog they should be added with " +
        "standardized schema for streaming events."
    );
  }

  const { inputs } = run;

  if (["retriever", "llm", "prompt"].includes(run.run_type)) {
    return inputs;
  }

  if (Object.keys(inputs).length === 1 && inputs?.input === "") {
    return undefined;
  }

  // new style chains
  // These nest an additional 'input' key inside the 'inputs' to make sure
  // the input is always a dict. We need to unpack and user the inner value.
  // We should try to fix this in Runnables and callbacks/tracers
  // Runnables should be using a null type here not a placeholder
  // dict.
  return inputs.input;
}

async function _getStandardizedOutputs(run: Run, schemaFormat: SchemaFormat) {
  const { outputs } = run;
  if (schemaFormat === "original") {
    // Return the old schema, without standardizing anything
    return outputs;
  }

  if (["retriever", "llm", "prompt"].includes(run.run_type)) {
    return outputs;
  }

  // TODO: Remove this hacky check
  if (
    outputs !== undefined &&
    Object.keys(outputs).length === 1 &&
    outputs?.output !== undefined
  ) {
    return outputs.output;
  }

  return outputs;
}

function isChatGenerationChunk(
  x?: ChatGenerationChunk | GenerationChunk
): x is ChatGenerationChunk {
  return x !== undefined && (x as ChatGenerationChunk).message !== undefined;
}

/**
 * Class that extends the `BaseTracer` class from the
 * `langchain.callbacks.tracers.base` module. It represents a callback
 * handler that logs the execution of runs and emits `RunLog` instances to a
 * `RunLogStream`.
 */
export class LogStreamCallbackHandler extends BaseTracer {
  protected autoClose = true;

  protected includeNames?: string[];

  protected includeTypes?: string[];

  protected includeTags?: string[];

  protected excludeNames?: string[];

  protected excludeTypes?: string[];

  protected excludeTags?: string[];

  protected _schemaFormat: SchemaFormat = "original";

  protected rootId?: string;

  private keyMapByRunId: Record<string, string> = {};

  private counterMapByRunName: Record<string, number> = {};

  protected transformStream: TransformStream;

  public writer: WritableStreamDefaultWriter;

  public receiveStream: IterableReadableStream<RunLogPatch>;

  name = "log_stream_tracer";

  constructor(fields?: LogStreamCallbackHandlerInput) {
    super(fields);
    this.autoClose = fields?.autoClose ?? true;
    this.includeNames = fields?.includeNames;
    this.includeTypes = fields?.includeTypes;
    this.includeTags = fields?.includeTags;
    this.excludeNames = fields?.excludeNames;
    this.excludeTypes = fields?.excludeTypes;
    this.excludeTags = fields?.excludeTags;
    this._schemaFormat = fields?._schemaFormat ?? this._schemaFormat;
    this.transformStream = new TransformStream();
    this.writer = this.transformStream.writable.getWriter();
    this.receiveStream = IterableReadableStream.fromReadableStream(
      this.transformStream.readable
    );
  }

  [Symbol.asyncIterator]() {
    return this.receiveStream;
  }

  protected async persistRun(_run: Run): Promise<void> {
    // This is a legacy method only called once for an entire run tree
    // and is therefore not useful here
  }

  _includeRun(run: Run): boolean {
    if (run.id === this.rootId) {
      return false;
    }
    const runTags = run.tags ?? [];
    let include =
      this.includeNames === undefined &&
      this.includeTags === undefined &&
      this.includeTypes === undefined;
    if (this.includeNames !== undefined) {
      include = include || this.includeNames.includes(run.name);
    }
    if (this.includeTypes !== undefined) {
      include = include || this.includeTypes.includes(run.run_type);
    }
    if (this.includeTags !== undefined) {
      include =
        include ||
        runTags.find((tag) => this.includeTags?.includes(tag)) !== undefined;
    }
    if (this.excludeNames !== undefined) {
      include = include && !this.excludeNames.includes(run.name);
    }
    if (this.excludeTypes !== undefined) {
      include = include && !this.excludeTypes.includes(run.run_type);
    }
    if (this.excludeTags !== undefined) {
      include =
        include && runTags.every((tag) => !this.excludeTags?.includes(tag));
    }
    return include;
  }

  async *tapOutputIterable<T>(
    runId: string,
    output: AsyncGenerator<T>
  ): AsyncGenerator<T> {
    // Tap an output async iterator to stream its values to the log.
    for await (const chunk of output) {
      // root run is handled in .streamLog()
      if (runId !== this.rootId) {
        // if we can't find the run silently ignore
        // eg. because this run wasn't included in the log
        const key = this.keyMapByRunId[runId];
        if (key) {
          await this.writer.write(
            new RunLogPatch({
              ops: [
                {
                  op: "add",
                  path: `/logs/${key}/streamed_output/-`,
                  value: chunk,
                },
              ],
            })
          );
        }
      }
      yield chunk;
    }
  }

  async onRunCreate(run: Run): Promise<void> {
    if (this.rootId === undefined) {
      this.rootId = run.id;
      await this.writer.write(
        new RunLogPatch({
          ops: [
            {
              op: "replace",
              path: "",
              value: {
                id: run.id,
                name: run.name,
                type: run.run_type,
                streamed_output: [],
                final_output: undefined,
                logs: {},
              },
            },
          ],
        })
      );
    }

    if (!this._includeRun(run)) {
      return;
    }

    if (this.counterMapByRunName[run.name] === undefined) {
      this.counterMapByRunName[run.name] = 0;
    }
    this.counterMapByRunName[run.name] += 1;
    const count = this.counterMapByRunName[run.name];
    this.keyMapByRunId[run.id] =
      count === 1 ? run.name : `${run.name}:${count}`;

    const logEntry: LogEntry = {
      id: run.id,
      name: run.name,
      type: run.run_type,
      tags: run.tags ?? [],
      metadata: run.extra?.metadata ?? {},
      start_time: new Date(run.start_time).toISOString(),
      streamed_output: [],
      streamed_output_str: [],
      final_output: undefined,
      end_time: undefined,
    };

    if (this._schemaFormat === "streaming_events") {
      logEntry.inputs = await _getStandardizedInputs(run, this._schemaFormat);
    }

    await this.writer.write(
      new RunLogPatch({
        ops: [
          {
            op: "add",
            path: `/logs/${this.keyMapByRunId[run.id]}`,
            value: logEntry,
          },
        ],
      })
    );
  }

  async onRunUpdate(run: Run): Promise<void> {
    try {
      const runName = this.keyMapByRunId[run.id];
      if (runName === undefined) {
        return;
      }
      const ops: JSONPatchOperation[] = [];
      if (this._schemaFormat === "streaming_events") {
        ops.push({
          op: "replace",
          path: `/logs/${runName}/inputs`,
          value: await _getStandardizedInputs(run, this._schemaFormat),
        });
      }
      ops.push({
        op: "add",
        path: `/logs/${runName}/final_output`,
        value: await _getStandardizedOutputs(run, this._schemaFormat),
      });
      if (run.end_time !== undefined) {
        ops.push({
          op: "add",
          path: `/logs/${runName}/end_time`,
          value: new Date(run.end_time).toISOString(),
        });
      }
      const patch = new RunLogPatch({ ops });
      await this.writer.write(patch);
    } finally {
      if (run.id === this.rootId) {
        const patch = new RunLogPatch({
          ops: [
            {
              op: "replace",
              path: "/final_output",
              value: await _getStandardizedOutputs(run, this._schemaFormat),
            },
          ],
        });
        await this.writer.write(patch);
        if (this.autoClose) {
          await this.writer.close();
        }
      }
    }
  }

  async onLLMNewToken(
    run: Run,
    token: string,
    kwargs?: HandleLLMNewTokenCallbackFields
  ): Promise<void> {
    const runName = this.keyMapByRunId[run.id];
    if (runName === undefined) {
      return;
    }
    // TODO: Remove hack
    const isChatModel = run.inputs.messages !== undefined;
    let streamedOutputValue;
    if (isChatModel) {
      if (isChatGenerationChunk(kwargs?.chunk)) {
        streamedOutputValue = kwargs?.chunk;
      } else {
        streamedOutputValue = new AIMessageChunk(token);
      }
    } else {
      streamedOutputValue = token;
    }
    const patch = new RunLogPatch({
      ops: [
        {
          op: "add",
          path: `/logs/${runName}/streamed_output_str/-`,
          value: token,
        },
        {
          op: "add",
          path: `/logs/${runName}/streamed_output/-`,
          value: streamedOutputValue,
        },
      ],
    });
    await this.writer.write(patch);
  }
}
