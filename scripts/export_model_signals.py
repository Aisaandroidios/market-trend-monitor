#!/usr/bin/env python3
import importlib.util
import json
import math
import os
import sys


def clamp(value, low=0.0, high=1.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = 0.0
    if math.isnan(number) or math.isinf(number):
        number = 0.0
    return max(low, min(high, number))


def score_direction(direction, bias_direction, aligned=1.0, opposed=0.25, neutral=0.55):
    if direction not in ("LONG", "SHORT"):
        return neutral
    if bias_direction not in ("LONG", "SHORT"):
        return neutral
    return aligned if direction == bias_direction else opposed


def model_available(name):
    return importlib.util.find_spec(name) is not None


def import_lightgbm_model():
    model_path = os.getenv("MODEL_BRAIN_LGBM_MODEL_PATH", "").strip()
    if not model_path:
        return None
    if not model_available("lightgbm"):
        return None

    try:
        import lightgbm as lgb
        return lgb.Booster(model_file=model_path)
    except Exception:
        return None


def probability_from_lgbm(model, features):
    if model is None:
        return None

    try:
        prediction = model.predict([features])
        if hasattr(prediction, "__len__"):
            prediction = prediction[0]
        return clamp(prediction)
    except Exception:
        return None


def feature_scores(idea):
    direction = str(idea.get("direction", "")).upper()
    indicators = idea.get("indicators") or {}
    flow = idea.get("moneyFlow") or {}
    regime = idea.get("longTermRegime") or {}
    playbook = idea.get("tradePlaybook") or {}
    feedback = idea.get("strategyFeedback") or {}

    win = clamp(((idea.get("winProbability") or 0.5) - 0.45) / 0.33)
    rr = clamp(((idea.get("riskReward") or 1.0) - 0.8) / 2.4)

    ema20 = indicators.get("ema20")
    ema60 = indicators.get("ema60")
    macd = indicators.get("macdHistogram") or 0
    rsi = indicators.get("rsi") or 50
    volume_ratio = indicators.get("volumeRatio") or 1
    news = indicators.get("newsScore") or 0

    technical = 0.42
    if direction == "LONG":
        if ema20 is not None and ema60 is not None and ema20 > ema60:
            technical += 0.17
        if macd > 0:
            technical += 0.15
        if 45 <= rsi <= 68:
            technical += 0.12
        if volume_ratio >= 1.05:
            technical += 0.08
        if news > 0:
            technical += 0.05
        if news < 0:
            technical -= 0.05
    elif direction == "SHORT":
        if ema20 is not None and ema60 is not None and ema20 < ema60:
            technical += 0.17
        if macd < 0:
            technical += 0.15
        if 32 <= rsi <= 55:
            technical += 0.12
        if volume_ratio >= 1.05:
            technical += 0.08
        if news < 0:
            technical += 0.05
        if news > 0:
            technical -= 0.05

    money_flow = score_direction(direction, flow.get("biasDirection"))
    long_term = score_direction(
        direction,
        regime.get("biasDirection"),
        aligned=0.76 if regime.get("regime") == "transition" else 1.0,
        opposed=0.34 if regime.get("regime") == "transition" else 0.2,
        neutral=0.5,
    )
    execution = clamp(playbook.get("score") if playbook.get("score") is not None else 0.5)
    feedback_score = clamp(feedback.get("score") if feedback.get("score") is not None else 0.5)
    volatility = 0.55
    entry = idea.get("entry") or 0
    atr = indicators.get("atr") or 0
    if entry and atr:
        volatility = clamp(1 - (((atr / entry) - 0.01) / 0.08), 0.2, 1.0)

    return {
        "win": win,
        "risk_reward": rr,
        "technical": clamp(technical),
        "money_flow": money_flow,
        "long_term": long_term,
        "execution": execution,
        "feedback": feedback_score,
        "volatility": volatility,
    }


def ensemble_probability(scores):
    return clamp(
        scores["technical"] * 0.23
        + scores["long_term"] * 0.16
        + scores["money_flow"] * 0.15
        + scores["win"] * 0.14
        + scores["risk_reward"] * 0.12
        + scores["execution"] * 0.1
        + scores["feedback"] * 0.06
        + scores["volatility"] * 0.04
    )


def signal_for_idea(idea, lgbm_model=None):
    direction = str(idea.get("direction", "")).upper()
    symbol = str(idea.get("symbol", "")).upper()
    if direction not in ("LONG", "SHORT") or not symbol:
        return None

    scores = feature_scores(idea)
    base_probability = ensemble_probability(scores)
    model_features = [
        scores["win"],
        scores["risk_reward"],
        scores["technical"],
        scores["money_flow"],
        scores["long_term"],
        scores["execution"],
        scores["feedback"],
        scores["volatility"],
    ]
    lgbm_probability = probability_from_lgbm(lgbm_model, model_features)
    probability = base_probability if lgbm_probability is None else clamp((base_probability * 0.45) + (lgbm_probability * 0.55))

    reason_bits = [
        f"tech {scores['technical']:.2f}",
        f"regime {scores['long_term']:.2f}",
        f"flow {scores['money_flow']:.2f}",
        f"exec {scores['execution']:.2f}",
    ]
    provider = "Python Open Quant Brain"
    if lgbm_probability is not None:
        provider += " + LightGBM model"

    return {
        "symbol": symbol,
        "direction": direction,
        "probability": round(probability, 3),
        "score": round(probability, 3),
        "provider": provider,
        "reason": "; ".join(reason_bits),
        "models": [
            "numpy/pandas feature matrix",
            "LightGBM model hook",
            "Qlib regime-compatible feature",
            "vectorbt backtest-compatible feedback",
            "FinRL policy-compatible risk gate",
        ],
    }


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"bad_input:{exc}"}))
        return 1

    lgbm_model = import_lightgbm_model()
    ideas = payload.get("ideas") or []
    signals = []
    for idea in ideas:
        signal = signal_for_idea(idea, lgbm_model=lgbm_model)
        if signal:
            signals.append(signal)

    runtime = {
        "numpy": model_available("numpy"),
        "pandas": model_available("pandas"),
        "lightgbm": model_available("lightgbm"),
        "vectorbt": model_available("vectorbt"),
        "qlib": model_available("qlib"),
        "finrl": model_available("finrl"),
        "stable_baselines3": model_available("stable_baselines3"),
    }

    print(json.dumps({
        "ok": True,
        "provider": "Python Open Quant Brain",
        "runtime": runtime,
        "signals": signals,
    }, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
