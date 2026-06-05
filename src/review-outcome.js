export function isPlannedExitReview(review) {
  return (review?.outcome === "RIGHT" && review?.hit === "TAKE_PROFIT")
    || (review?.outcome === "WRONG" && review?.hit === "STOP_LOSS");
}

export function hasReviewOutcome(review) {
  return ["RIGHT", "WRONG", "PENDING"].includes(review?.outcome);
}

export function normalizeReviewForStats(review) {
  if (!hasReviewOutcome(review)) return null;
  if (isPlannedExitReview(review) || review.outcome === "PENDING") return review;

  return {
    ...review,
    outcome: "PENDING",
    label: "观察中",
    hit: review.hit ?? "NONE",
    detail: "尚未触发止盈/止损，继续观察，不计入胜负。"
  };
}
