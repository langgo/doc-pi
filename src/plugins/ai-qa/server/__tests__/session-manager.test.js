import { describe, it, expect, beforeEach, mock } from 'bun:test';

// Capture the mock session so tests can access it
let capturedSession = null;
let createdAuthStorages = [];

// Default (success) factory
function defaultFactory() {
  let subscriber = null;
  const s = {
    sendCustomMessage: mock(async () => {}),
    sendUserMessage: mock(async () => {}),
    prompt: mock(async () => {}),
    subscribe: mock((fn) => {
      subscriber = fn;
      return () => { subscriber = null; };
    }),
    dispose: mock(async () => {}),
    _emit: (event) => {
      if (subscriber) subscriber(event);
    },
  };
  capturedSession = s;
  return { session: s, extensionsResult: null };
}

class MockAuthStorage {
  static create = mock(async (dbPath) => {
    const storage = new MockAuthStorage(dbPath);
    createdAuthStorages.push(storage);
    return storage;
  });

  constructor(dbPath) {
    this.dbPath = dbPath;
    this.close = mock(() => {});
  }
}

class MockModelRegistry {
  constructor(authStorage, modelsPath) {
    this.authStorage = authStorage;
    this.modelsPath = modelsPath;
  }

  getAvailable() {
    return [{ provider: 'deepseek', id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }];
  }
}

// Mock the SDK before importing the module under test
mock.module('@oh-my-pi/pi-coding-agent', () => {
  return {
    createAgentSession: mock(defaultFactory),
    SessionManager: {
      inMemory: mock(() => ({})),
    },
    AuthStorage: MockAuthStorage,
    ModelRegistry: MockModelRegistry,
  };
});

import {
  askQuestion,
  disposeRuntimeSession,
  getRuntimeSessionCount,
  isSdkAvailable,
  isPersistThinking,
  resetForTesting,
  configure,
  historyStore,
} from '../session-manager.js';
import { createAgentSession } from '@oh-my-pi/pi-coding-agent';
import { setRuntimeConfig } from '../../../../core/server/runtime-state.js';

describe('session-manager', () => {
  beforeEach(async () => {
    resetForTesting();
    setRuntimeConfig({ rootDir: process.cwd(), aiQa: { agentDir: '/tmp/test-agent', historyDir: `/tmp/test-history-${Date.now()}-${Math.random()}` } });
    configure({ agentDir: '/tmp/test-agent' });
    capturedSession = null;
    createdAuthStorages = [];
    MockAuthStorage.create.mockClear();
    createAgentSession.mockImplementation(defaultFactory);
  });

  describe('askQuestion', () => {
    it('passes auth storage and agent models.yml registry into runtime session creation', async () => {
      const stream = await askQuestion('conv-model', {
        question: 'test',
        selectedText: '',
        contextBefore: '',
        contextAfter: '',
        chapterFile: '01-概述.md',
      });

      const options = createAgentSession.mock.calls[0][0];
      expect(options.model).toBeUndefined();
      expect(options.authStorage).toBe(createdAuthStorages[0]);
      expect(options.modelRegistry.authStorage).toBe(createdAuthStorages[0]);
      expect(options.modelRegistry.modelsPath).toBe('/tmp/test-agent/models.yml');

      capturedSession._emit({ type: 'agent_end' });
      for await (const _ of stream) { /* drain */ }
    });

    it('should create a runtime session on first question', async () => {
      const stream = await askQuestion('conv-1', {
        question: 'test',
        selectedText: '',
        contextBefore: '',
        contextAfter: '',
        chapterFile: '01-概述.md',
      });

      expect(getRuntimeSessionCount()).toBe(1);
      expect(capturedSession).not.toBeNull();
      expect(capturedSession.sendCustomMessage).toHaveBeenCalled();

      // Clean up
      capturedSession._emit({ type: 'agent_end' });
      for await (const _ of stream) { /* drain */ }
    });

    it('should send system prompt on runtime session creation', async () => {
      const stream = await askQuestion('conv-2', {
        question: 'test',
        selectedText: '',
        contextBefore: '',
        contextAfter: '',
        chapterFile: '01-概述.md',
      });

      expect(capturedSession.sendCustomMessage).toHaveBeenCalled();
      const call = capturedSession.sendCustomMessage.mock.calls[0][0];
      expect(call.role).toBe('system');
      expect(call.content).toContain('ElasticSearch');
      expect(call.content).toContain('read');
      expect(call.content).toContain('web_search');

      capturedSession._emit({ type: 'agent_end' });
      for await (const _ of stream) { /* drain */ }
    });

    it('should reuse existing runtime session for same conversationId', async () => {
      const stream1 = await askQuestion('conv-3', {
        question: 'q1',
        selectedText: '',
        contextBefore: '',
        contextAfter: '',
        chapterFile: '01-概述.md',
      });
      capturedSession._emit({ type: 'agent_end' });
      for await (const _ of stream1) { /* drain */ }

      const firstSession = capturedSession;
      createAgentSession.mockImplementation(defaultFactory); // reset for next call

      const stream2 = await askQuestion('conv-3', {
        question: 'q2',
        selectedText: '',
        contextBefore: '',
        contextAfter: '',
        chapterFile: '01-概述.md',
      });

      // Should reuse, not create new
      expect(getRuntimeSessionCount()).toBe(1);
      expect(capturedSession).toBe(firstSession);

      capturedSession._emit({ type: 'agent_end' });
      for await (const _ of stream2) { /* drain */ }
    });

    it('should enforce max runtime session limit', async () => {
      // Track all created sessions so we can emit agent_end on each
      const allSessions = [];
      createAgentSession.mockImplementation(() => {
        const result = defaultFactory();
        allSessions.push(result.session);
        return result;
      });

      const streams = [];
      for (let i = 0; i < 5; i++) {
        const s = await askQuestion('conv-max-' + i, {
          question: 'test',
          selectedText: '',
          contextBefore: '',
          contextAfter: '',
          chapterFile: '01-概述.md',
        });
        streams.push(s);
      }
      expect(getRuntimeSessionCount()).toBe(5);

      await expect(askQuestion('conv-max-5', {
        question: 'test',
        selectedText: '',
        contextBefore: '',
        contextAfter: '',
        chapterFile: '01-概述.md',
      })).rejects.toThrow('上限');

      // Clean up — emit agent_end on each session and drain
      for (let i = 0; i < allSessions.length; i++) {
        allSessions[i]._emit({ type: 'agent_end' });
      }
      for (const s of streams) {
        for await (const _ of s) { /* drain */ }
      }
    });

    it('should mark SDK unavailable on creation failure', async () => {
      createAgentSession.mockImplementation(async () => {
        throw new Error('SDK crash');
      });

      await expect(askQuestion('conv-fail', {
        question: 'test',
        selectedText: '',
        contextBefore: '',
        contextAfter: '',
        chapterFile: '01-概述.md',
      })).rejects.toThrow('暂不可用');
      expect(isSdkAvailable()).toBe(false);
    });

    it('should stream text deltas', async () => {
      const streamPromise = askQuestion('conv-stream', {
        question: '什么是ElasticSearch？',
        selectedText: 'ElasticSearch',
        contextBefore: '前面内容',
        contextAfter: '后面内容',
        chapterFile: '01-概述.md',
      });

      // Wait for askQuestion to set up the subscriber
      await new Promise(r => setTimeout(r, 20));

      capturedSession._emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'ElasticSearch' } });
      capturedSession._emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '是' } });
      capturedSession._emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '一个搜索引擎' } });
      capturedSession._emit({ type: 'agent_end' });

      const stream = await streamPromise;
      const results = [];
      for await (const { delta } of stream) {
        results.push(delta);
      }

      expect(results).toEqual(['ElasticSearch', '是', '一个搜索引擎']);
    });

    it('should stream thinking and text deltas', async () => {
      const streamPromise = askQuestion('conv-think', {
        question: '需要推理的问题',
        selectedText: '',
        contextBefore: '',
        contextAfter: '',
        chapterFile: '01-概述.md',
      });

      await new Promise(r => setTimeout(r, 20));

      capturedSession._emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: '先分析' } });
      capturedSession._emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '最终答案' } });
      capturedSession._emit({ type: 'agent_end' });

      const stream = await streamPromise;
      const results = [];
      for await (const event of stream) {
        results.push(event);
      }

      expect(results).toEqual([
        { type: 'thinking_delta', delta: '先分析' },
        { type: 'text_delta', delta: '最终答案' },
      ]);
    });

    it('should include context in the prompt', async () => {
      const streamPromise = askQuestion('conv-ctx', {
        question: '测试问题',
        selectedText: '选中的文本',
        contextBefore: '上文',
        contextAfter: '下文',
        chapterFile: '02-核心概念.md',
      });

      await new Promise(r => setTimeout(r, 20));
      capturedSession._emit({ type: 'agent_end' });

      // Drain the stream (for await also awaits the promise)
      const stream = await streamPromise;
      for await (const _ of stream) { /* drain */ }

      expect(capturedSession.prompt).toHaveBeenCalled();
      const promptArg = capturedSession.prompt.mock.calls[0][0];
      expect(promptArg).toContain('02-核心概念.md');
      expect(promptArg).toContain('选中的文本');
      expect(promptArg).toContain('上文');
      expect(promptArg).toContain('下文');
      expect(promptArg).toContain('测试问题');
    });
  });

  describe('disposeRuntimeSession', () => {
    it('should remove runtime session and call dispose', async () => {
      const stream = await askQuestion('conv-dispose', {
        question: 'test',
        selectedText: '',
        contextBefore: '',
        contextAfter: '',
        chapterFile: '01-概述.md',
      });
      const session = capturedSession;

      capturedSession._emit({ type: 'agent_end' });
      for await (const _ of stream) { /* drain */ }

      const disposed = await disposeRuntimeSession('conv-dispose');

      expect(disposed).toBe(true);
      expect(session.dispose).toHaveBeenCalled();
      expect(createdAuthStorages[0].close).toHaveBeenCalled();
      expect(getRuntimeSessionCount()).toBe(0);
    });

    it('should be a no-op for non-existent runtime session', async () => {
      const disposed = await disposeRuntimeSession('nonexistent');
      expect(disposed).toBe(false);
    });
  });

  describe('getRuntimeSessionCount', () => {
    it('should return 0 initially', () => {
      expect(getRuntimeSessionCount()).toBe(0);
    });
  });

  describe('isPersistThinking', () => {
    it('should return false by default', () => {
      expect(isPersistThinking()).toBe(false);
    });

    it('should return true when configured', () => {
      resetForTesting();
      configure({ agentDir: '/tmp/test-agent', persistThinking: true });
      expect(isPersistThinking()).toBe(true);
    });
  });
});
