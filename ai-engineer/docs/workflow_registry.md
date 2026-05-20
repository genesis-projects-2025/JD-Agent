# Multi-Agent Workflow Graphs Registry

Workflows map out structural patterns in which agents communicate, represented by LangGraph diagrams.

## 1. Interview Workflow
* **Entry Node**: Phase classification.
* **Loop**: Questions -> Parse answers -> Update Session state -> Next question.
* **End Node**: JD Synthesis & document compilation.

## 2. Code Change Workflow
* **Path**: Decompose spec -> Create codebase files -> Generate test files -> Run tests -> Adjust bugs -> Request PR approval.\n