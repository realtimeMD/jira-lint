jest.spyOn(console, 'log').mockImplementation(); // avoid actual console.log in test output

const mockGetInput = jest.fn();
const mockSetFailed = jest.fn();

jest.mock('@actions/core', () => ({
  getInput: (...args: unknown[]) => mockGetInput(...args),
  setFailed: (...args: unknown[]) => mockSetFailed(...args),
}));

jest.mock('@actions/github', () => ({
  context: {},
  getOctokit: jest.fn(() => ({})),
}));

const mockGetTicketDetails = jest.fn();
const mockAddComment = jest.fn();
const mockAddLabels = jest.fn();
const mockUpdatePrDetails = jest.fn();

jest.mock('../src/utils', () => {
  const actual = jest.requireActual('../src/utils');
  return {
    ...actual,
    addComment: (...args: unknown[]) => mockAddComment(...args),
    addLabels: (...args: unknown[]) => mockAddLabels(...args),
    updatePrDetails: (...args: unknown[]) => mockUpdatePrDetails(...args),
    getJIRAClient: () => ({ getTicketDetails: mockGetTicketDetails }),
    shouldSkipBranchLint: () => false,
    shouldUpdatePRDescription: () => false,
    isIssueStatusValid: () => true,
  };
});

const inputDefaults: Record<string, string> = {
  'jira-token': 'jira-token',
  'jira-base-url': 'https://example.atlassian.net',
  'github-token': 'github-token',
  'skip-branches': '',
  'skip-comments': 'true',
  'pr-threshold': '800',
  validate_issue_status: 'false',
  allowed_issue_statuses: '',
};

const setupInputs = (overrides: Record<string, string> = {}): void => {
  const inputs = { ...inputDefaults, ...overrides };
  mockGetInput.mockImplementation((name: string) => inputs[name] ?? '');
};

interface PullRequestOverrides {
  head?: string;
  title?: string;
  body?: string;
}

const buildContext = ({ head = 'feature/generic-branch', title = '', body = '' }: PullRequestOverrides) => ({
  payload: {
    repository: { name: 'jira-lint' },
    organization: { login: 'cleartax' },
    pull_request: {
      base: { ref: 'master' },
      head: { ref: head },
      number: 1,
      additions: 1,
      title,
      body,
    },
  },
});

const flushPromises = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('run() - JIRA key resolution', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockGetTicketDetails.mockResolvedValue({ key: 'DAISY-1', project: {}, type: {}, status: '' });
    setupInputs();
  });

  it('prefers the key found in the PR title over one only present in the head branch', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const github = require('@actions/github');
    github.context = buildContext({ title: 'Fixes DAISY-1', head: 'related to DAISY-999' });

    require('../src/main');
    await flushPromises();

    expect(mockGetTicketDetails).toHaveBeenCalledWith('DAISY-1');
  });

  it('falls back to the PR head branch only when the title has no key', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const github = require('@actions/github');
    github.context = buildContext({ title: 'Generic title', head: 'related to DAISY-999' });

    require('../src/main');
    await flushPromises();

    expect(mockGetTicketDetails).toHaveBeenCalledWith('DAISY-999');
  });

  it('uses the last matching key when the title contains multiple keys', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const github = require('@actions/github');
    github.context = buildContext({ title: 'Fixes DAISY-1 then DAISY-2' });

    require('../src/main');
    await flushPromises();

    expect(mockGetTicketDetails).toHaveBeenCalledWith('DAISY-2');
  });

  it('does not use the branch name when a key is present in the title', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const github = require('@actions/github');
    github.context = buildContext({
      head: 'feature/DAISY-997-do-thing',
      title: 'Fixes DAISY-1',
      body: 'DAISY-999 DAISY-998',
    });

    require('../src/main');
    await flushPromises();

    expect(mockGetTicketDetails).toHaveBeenCalledWith('DAISY-1');
    expect(mockGetTicketDetails).not.toHaveBeenCalledWith('DAISY-999');
    expect(mockGetTicketDetails).not.toHaveBeenCalledWith('DAISY-998');
    expect(mockGetTicketDetails).not.toHaveBeenCalledWith('DAISY-997');
  });
});
