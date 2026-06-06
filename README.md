[![AuroraFlow CI Test Suite](https://github.com/jsugg/auroraflow/actions/workflows/ci.yml/badge.svg)](https://github.com/jsugg/auroraflow/actions/workflows/ci.yml)
# AuroraFlow :: Import Joy and Chill into your Test Scripts
![AuroraFlow Logo](https://github.com/jsugg/auroraflow/blob/main/.github/assets/auroraflow-logo.png?raw=true)

## ~ A Robust AI-Driven Test Automation Framework you can Rely on ~

## Objective

This document describes AuroraFlow's current Test Automation Framework (TAF) foundation and the target architecture it is growing toward. The implemented repository currently centers on Playwright, TypeScript, Redis data primitives, guarded self-healing artifacts, and JSON/Markdown observability reports. AI-driven Selector Analysis Tooling (SAT), Dockerized SAT services, Prometheus/Grafana/ELK/Jaeger infrastructure, encrypted Redis dump lifecycle, and autonomous selector optimization remain roadmap capabilities until corresponding services and workflows exist in source.

## Current Repository Status (April 2026)

AuroraFlow currently provides a hardened foundation and examples-first blueprint. The full platform vision in this README remains the target architecture and is not fully implemented yet.

Implemented now:

- Playwright + TypeScript framework core with Page Object + Page Factory patterns.
- Quality/security CI workflows (`quality.yml`, `security.yml`, `examples.yml`, full matrix in `ci.yml`).
- E2E matrix flakiness analytics artifacts (`flakiness-summary.json` and `flakiness-summary.md`).
- SLO dashboard and alert policy artifacts from matrix telemetry (`slo-dashboard*.{json,md}`, `slo-alerts*.{json,md}`).
- Guarded self-healing foundation with artifact capture, candidate ranking, dry-run validation, and guarded auto-apply retry controls.
- Redis data-layer primitives (`RedisClient`, selector registry repository) and Testcontainers integration tests.
- Runnable deterministic examples for page objects, quickstart, reliability, data-provider abstractions, observability patterns, and CI templates.

Planned/roadmap (not fully implemented yet):

- SAT ML pipeline and autonomous selector optimization lifecycle.
- Full production observability stack (Prometheus/Grafana/ELK/Jaeger) and trend dashboards.
- Extended platform governance automation and release/signing workflows.

## Target Architecture (Roadmap)

```mermaid
graph TD;
    CI[CI/CD Pipeline]-->|Triggers|TAF[Test Automation Framework];
    TAF-->|Uses|Redis[Redis for Test Data];
    TAF-->|Interacts with|Browser[Browsers via Playwright];
    Redis-.->|Planned data source|SAT[Selector Analysis Tooling];
    SAT-.->|Planned selector updates|Redis;
    TAF-->|Generates|Reports[JSON/Markdown Reports & Logs];
    Reports-.->|Planned production monitoring|Monitoring[Monitoring Tools];
    Monitoring-.->Prometheus;
    Monitoring-.->Grafana;
    Monitoring-.->ELK[Elasticsearch, Logstash, Kibana];
    TAF-->|Uses today|Docker[Docker Compose];
    Docker-->|Manages local Redis|Redis;
    Docker-.->|Planned service|SAT;
```

This roadmap diagram separates the implemented foundation from planned services. Today, Docker Compose manages local Redis only; SAT and the Prometheus/Grafana/ELK monitoring stack are target architecture, not current runtime infrastructure.

### Core Components

- **Node.js and TypeScript:** Serve as the backbone for the TAF, offering asynchronous execution and strong typing for robust, maintainable code.
- **Playwright:** Enables automated, cross-browser UI interactions and assertions, facilitating comprehensive test coverage.
- **Page Object Model (POM) & Page Factory:** Encapsulates UI element interactions, improving test maintenance and reducing redundancy.
- **Redis:** Provides implemented data-layer primitives for namespaced keys and selector registry records; autonomous selector updates are planned.
- **Docker Compose:** Currently orchestrates local Redis only. Dockerized SAT, TAF services, and Docker Swarm are not implemented yet.
- **AI-Driven SAT:** Planned capability for dynamic selector identification and updates based on DOM analysis.
- **Monitoring and Logging:** Currently implemented as structured logs plus JSON/Markdown flakiness, SLO, and alert artifacts. Prometheus, Grafana, ELK, and tracing backends are planned integrations.
- **Computer Vision:** Planned capability for complex or dynamic UI elements.

### Enhanced Features

- **Current Docker Compose support:** Provides a local Redis service with healthcheck and persistent volume for development and integration testing.
- **Current observability artifacts:** Generates flakiness summaries, SLO dashboards, and SLO alert evaluations as JSON/Markdown artifacts.
- **Planned Redis persistence:** Encrypted Redis dump backup/restore across CI runs.
- **Planned SAT ML:** Custom-built or open-source ML models for DOM analysis and selector optimization.
- **Planned monitoring stack:** Prometheus/Grafana metrics, ELK log analysis, and Jaeger or Zipkin tracing.
- **Failover Mechanisms & Robust Error Handling:** Implemented in framework action wrappers and Redis retry primitives; broader infrastructure failover remains planned.

### TAF Design Best Practices

- **Modularity and Encapsulation:** Page objects encapsulate UI interactions, while helper functions and utilities support reusable logic, promoting clean and modular code.
- **Asynchronous Programming:** Playwright's asynchronous API is fully leveraged, ensuring non-blocking operations and efficient execution.
- **Error Handling:** Custom error handling in page actions, with logging and screenshots on failure, enhances debugging and accountability.
- **Retry Mechanisms:** Implement retry logic with exponential backoff for flaky operations, improving test reliability.
- **Security:** CI includes dependency review, npm audit, CodeQL, gitleaks, and workflow security checks; encrypted Redis dump handling is planned.
- **Test Isolation:** Docker Compose and Testcontainers provide Redis isolation for local/integration scenarios; full Dockerized TAF/SAT isolation is planned.

### Project Structure and Setup

- Organized test codebase with clear directories for tests, page objects, helpers, and utilities, using TypeScript for type safety and readability.
- Configured Playwright for cross-browser testing (Chrome, Firefox, Safari, Edge) and managed test environments with environment variables and configuration files.

### Continuous Integration

- Integrated CI pipelines (GitHub Actions) for automated test execution, leveraging parallel test execution to optimize feedback time.
- Enhanced error handling and logging, including Playwright's screenshot and video capture on test failures, for improved debugging.

### Code Quality and Scalability

- Enforced coding standards with ESLint and Prettier, and optimized test execution through parallel test runs supported by Playwright.

### Documentation, Accessibility, and Knowledge Sharing

- Maintained comprehensive documentation for the test framework, including setup instructions and test writing guidelines.
- Incorporated accessibility checks into end-to-end tests, ensuring web applications are accessible to all users.

## Test Execution Flow

```mermaid
sequenceDiagram
    participant CI as CI Pipeline
    participant SAT as Selector Analysis Tooling Job
    participant TAF as Test Automation Framework Job
    participant Redis as Redis (Test Data)
    participant Browser as Browsers

    par SAT Job
        CI->>+SAT: Clone SAT Repo & Start Analysis
        SAT->>+Redis: Retrieve Current Selectors
        SAT->>+Browser: Analyze DOM for Selector Updates
        Browser-->>-SAT: DOM Analysis Results
        SAT-->>-Redis: Update Selectors if Needed
        SAT->>CI: SAT Job Completed
    and TAF Job
        CI->>+TAF: Install & Configure TAF
        note right of TAF: Waits for SAT Completion if Necessary
        TAF->>+Redis: Retrieve Updated Test Data & Selectors
        loop Test Execution
            TAF->>+Browser: Execute Tests
            Browser-->>-TAF: Test Results
        end
        TAF->>CI: Return Test Results & Artifacts
    end
```

This sequence diagram represents the target SAT-integrated flow. Current CI runs TAF test suites and artifact generation; it does not yet clone, run, or wait for a SAT job.

## Data Management and SAT Workflow

```mermaid
graph LR;
    SAT[Selector Analysis Tooling] --> |Analyzes & Updates| Redis[Redis - Test Data];
    Redis --> |Provides| TAF[Test Automation Framework];
    TAF --> |Test Execution| Browser[Browsers];
    TAF --> |Feedback Loop| SAT;
    Redis --> |Backed Up As| DB_Dump[Encrypted DB dump];
    DB_Dump --> |Restored For Next Test Run| Redis;
```

This diagram represents the target data-management workflow. Current source includes Redis client and selector registry primitives, but not SAT-driven Redis updates or encrypted Redis dump backup/restore.

## Implementation Details

### Docker Compose and Redis Configuration

- Use Docker Compose to spin up local Redis for development and integration testing. Current GitHub Actions rely on Testcontainers for Redis integration tests, not a Dockerized SAT stack.
- Manage Redis as the dynamic data store foundation for test selectors and URLs. Automated SAT updates and encrypted Redis dump backup/restore are planned.

### SAT Development and Integration

- Develop SAT as an independent, AI-driven tool that runs in parallel to TAF executions. It should analyze the application's UI, automatically identify changes in selectors, and update Redis accordingly. For separation of concerns, it resides on a separate repository.
- Utilize TensorFlow.js for building or customizing ML models, trained on historical test data and web application changes. Incorporate NLP techniques for improved page context understanding.

### CI/CD Pipeline Enhancements

- Implement GitHub Actions workflows to manage future TAF/SAT operations, Dockerized services, and Redis data lifecycle.
- Encrypt the Redis dump file for secure storage in the TAF repository and automatically decrypt/load it in Redis at the start of test runs.

### Monitoring, Logging, and Tracing Setup

- Current observability emits JSON/Markdown flakiness, SLO dashboard, and alert artifacts from Playwright report data.
- Configure Prometheus and Grafana for real-time monitoring once metrics exporters and dashboards exist.
- Utilize the ELK stack for comprehensive log analysis once log shipping/indexing infrastructure exists.
- Integrate Jaeger or Zipkin for tracing once tracing instrumentation and collectors exist.

### Best Practices and Security Measures

- Encapsulate UI interactions within page objects, using the Page Factory for instance management, to ensure code modularity and reusability.
- Implement robust error handling and custom exceptions within page actions, including screenshots on failure for enhanced debugging.
- Secure test data management with validated Redis configuration and GitHub secret scanning today; encrypted Redis dump handling remains planned.

## Current Infrastructure and Monitoring Status

```mermaid
graph TD;
    Docker[Docker Compose]-->|Current local service|Redis[Redis];
    Tests[Test Suites]-->|Use via RedisClient/Testcontainers|Redis;
    Tests-->|Generate|PlaywrightReports[Playwright JSON Reports];
    PlaywrightReports-->|Aggregate|Flakiness[Flakiness Summary JSON/MD];
    Flakiness-->|Feeds|SLO[SLO Dashboard JSON/MD];
    SLO-->|Evaluates|Alerts[SLO Alerts JSON/MD];
    SAT[Dockerized SAT]-.->|Planned|Redis;
    Monitoring[Prometheus/Grafana/ELK/Jaeger]-.->|Planned|Alerts;
```

Current infrastructure consists of local Redis orchestration, Testcontainers-backed Redis integration tests, and artifact-based observability. Dockerized SAT services and Prometheus/Grafana/ELK/Jaeger are intentionally documented as planned until the corresponding runtime services, exporters, dashboards, and workflows are implemented.

## Rationale Behind Architectural Choices

The proposed TAF architecture is designed to address the challenges of dynamic web UI testing at scale. The current implementation establishes the Playwright framework, Redis data primitives, guarded self-healing artifacts, and CI observability reports first. Dockerized SAT, autonomous selector updates, and production monitoring/tracing are planned follow-on layers that should be claimed as implemented only after the corresponding source, services, and CI workflows exist.

## Contributing

This exciting project is in the early development phase.
Hit me up if you are interested in contributing!
