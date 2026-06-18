import { useState, useEffect } from "react";

const STORAGE_KEY = "gaeats-units";

export function useUnits() {
  const [imperial, setImperialState] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "metric") setImperialState(false);
  }, []);

  function setImperial(value: boolean) {
    setImperialState(value);
    localStorage.setItem(STORAGE_KEY, value ? "imperial" : "metric");
  }

  return { imperial, setImperial };
}
