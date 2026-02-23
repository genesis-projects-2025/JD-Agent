/**
 * Simple authentication helper to maintain a persistent employee identity
 * without a full auth system. Stores a unique ID in localStorage.
 */

export function getOrCreateEmployeeId(): string {
  if (typeof window === "undefined") return "server_id";

  let id = localStorage.getItem("employee_id");
  if (!id) {
    // Generate a unique employee ID
    id =
      "emp_" +
      Math.random().toString(36).substring(2, 11) +
      Date.now().toString(36);
    localStorage.setItem("employee_id", id);
    console.log("🆕 Created New Employee ID:", id);
  } else {
    console.log("💾 Using Existing Employee ID:", id);
  }
  return id;
}

export function getEmployeeId(): string | null {
  if (typeof window === "undefined") return null;
  const id = localStorage.getItem("employee_id");
  if (id) {
    console.log("🆔 Accessed Employee ID:", id);
  }
  return id;
}
