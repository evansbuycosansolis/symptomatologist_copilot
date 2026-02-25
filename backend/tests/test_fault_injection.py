from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main as backend_main  # noqa: E402


class _OpenAITimeoutStub:
    class _Completions:
        def create(self, *args, **kwargs):
            raise httpx.ReadTimeout("simulated openai timeout")

    class _Chat:
        def __init__(self) -> None:
            self.completions = _OpenAITimeoutStub._Completions()

    def __init__(self) -> None:
        self.chat = _OpenAITimeoutStub._Chat()


client = TestClient(backend_main.app)


async def _raise_timeout(*args, **kwargs):
    raise httpx.ReadTimeout("simulated timeout")


async def _raise_connect_error(*args, **kwargs):
    raise httpx.ConnectError("simulated connection failure")


async def _ok_trials(*args, **kwargs):
    return [
        {
            "nct_id": "NCT00000000",
            "title": "Mock Trial",
            "status": "COMPLETED",
            "url": "https://clinicaltrials.gov/study/NCT00000000",
        }
    ]


async def _ok_rxnav(*args, **kwargs):
    return ["MockDrug 10 MG Oral Tablet"]


def test_chat_falls_back_when_openai_times_out():
    with patch.object(backend_main, "OPENAI_CLIENT", _OpenAITimeoutStub()):
        resp = client.post(
            "/chat",
            json={"history": [{"role": "user", "content": "hello timeout"}]},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert "reply" in body
    assert isinstance(body["reply"], str)
    assert "fallback" in body["reply"].lower() or "Local fallback".lower() in body["reply"].lower()


def test_medical_references_survives_partial_external_failures():
    with (
        patch.object(backend_main, "_pubmed_search", _raise_timeout),
        patch.object(backend_main, "_clinical_trials_search", _ok_trials),
        patch.object(backend_main, "_rxnav_lookup", _ok_rxnav),
        patch.object(backend_main, "OPENAI_CLIENT", None),
    ):
        resp = client.post(
            "/medical_references",
            json={
                "query": "migraine management",
                "max_pubmed": 2,
                "max_trials": 2,
                "max_rxnorm": 5,
                "summarize": True,
                "max_summary_paragraphs": 2,
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body.get("errors"), list)
    assert any("PubMed lookup failed" in e for e in body["errors"])
    assert body["clinical_trials"]
    assert body["rxnorm"]
    assert isinstance(body.get("report_text"), str) and "MEDICAL REFERENCES REPORT" in body["report_text"]
    assert isinstance(body.get("summary_text"), str)


def test_medical_references_survives_all_external_failures():
    with (
        patch.object(backend_main, "_pubmed_search", _raise_connect_error),
        patch.object(backend_main, "_clinical_trials_search", _raise_connect_error),
        patch.object(backend_main, "_rxnav_lookup", _raise_connect_error),
        patch.object(backend_main, "OPENAI_CLIENT", None),
    ):
        resp = client.post(
            "/medical_references",
            json={
                "query": "sepsis bundle",
                "max_pubmed": 2,
                "max_trials": 2,
                "max_rxnorm": 2,
                "summarize": True,
                "max_summary_paragraphs": 2,
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["errors"]) == 3
    assert "PUBMED" in body["report_text"]
    assert "CLINICALTRIALS.GOV" in body["report_text"]
    assert "RXNAV / RXNORM" in body["report_text"]
    assert isinstance(body["summary_text"], str)


def test_rxnav_lookup_returns_502_on_unexpected_helper_failure():
    with patch.object(backend_main, "_rxnav_lookup", _raise_timeout):
        resp = client.get("/rxnav_lookup", params={"query": "metformin"})
    assert resp.status_code == 502
    assert "RxNav lookup failed" in resp.json()["detail"]
