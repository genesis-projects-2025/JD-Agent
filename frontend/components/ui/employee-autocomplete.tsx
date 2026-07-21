"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search, User, Briefcase, Building, Check, Loader2, ChevronDown } from "lucide-react";
import { fetchOrganogramEmployees } from "@/lib/api";

export interface EmployeeOption {
  emp_code: string;
  emp_name: string;
  role?: string;
  department?: string;
}

interface EmployeeAutocompleteProps {
  employeeId: string;
  employeeName: string;
  onSelect: (emp: EmployeeOption) => void;
  onIdChange: (val: string) => void;
  onNameChange: (val: string) => void;
  disabled?: boolean;
  theme?: "blue" | "indigo";
}

export function EmployeeAutocomplete({
  employeeId,
  employeeName,
  onSelect,
  onIdChange,
  onNameChange,
  disabled = false,
  theme = "blue",
}: EmployeeAutocompleteProps) {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeInput, setActiveInput] = useState<"id" | "name" | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch organogram employees list once on mount
  useEffect(() => {
    let isMounted = true;
    async function loadOrganogram() {
      try {
        setLoading(true);
        const data = await fetchOrganogramEmployees();
        if (isMounted && data?.employees) {
          const list = data.employees.map((emp: any) => ({
            emp_code: String(emp.emp_code || "").trim(),
            emp_name: String(emp.emp_name || "").trim(),
            role: String(emp.role || "").trim(),
            department: String(emp.department || "").trim(),
          }));
          setEmployees(list);
        }
      } catch (err) {
        console.error("Failed to load organogram employees for autocomplete:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadOrganogram();
    return () => {
      isMounted = false;
    };
  }, []);

  // Handle click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
        setActiveInput(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Filter matching employees based on active input search query
  const query = (activeInput === "id" ? employeeId : employeeName).toLowerCase().trim();

  const filteredEmployees = employees.filter((emp) => {
    if (!query) return true;
    return (
      emp.emp_name.toLowerCase().includes(query) ||
      emp.emp_code.toLowerCase().includes(query) ||
      (emp.department && emp.department.toLowerCase().includes(query)) ||
      (emp.role && emp.role.toLowerCase().includes(query))
    );
  }).slice(0, 30); // Limit to top 30 matches for fast render

  const handleSelectOption = (emp: EmployeeOption) => {
    onIdChange(emp.emp_code);
    onNameChange(emp.emp_name);
    onSelect(emp);
    setDropdownOpen(false);
    setActiveInput(null);
  };

  const ringClass = theme === "indigo" 
    ? "focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
    : "focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500";

  const badgeTheme = theme === "indigo"
    ? "bg-indigo-50 text-indigo-700 border-indigo-200"
    : "bg-blue-50 text-blue-700 border-blue-200";

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Employee ID Input */}
        <div className="relative">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Employee ID *
          </label>
          <div className="relative">
            <input
              type="text"
              value={employeeId}
              onChange={(e) => {
                onIdChange(e.target.value);
                setActiveInput("id");
                setDropdownOpen(true);
              }}
              onFocus={() => {
                setActiveInput("id");
                setDropdownOpen(true);
              }}
              placeholder="Type Employee Code (e.g. E10212)..."
              className={`w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none transition-all ${ringClass}`}
              disabled={disabled}
            />
            {loading && activeInput === "id" && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
              </div>
            )}
          </div>
        </div>

        {/* Employee Name Input */}
        <div className="relative">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Employee Name *
          </label>
          <div className="relative">
            <input
              type="text"
              value={employeeName}
              onChange={(e) => {
                onNameChange(e.target.value);
                setActiveInput("name");
                setDropdownOpen(true);
              }}
              onFocus={() => {
                setActiveInput("name");
                setDropdownOpen(true);
              }}
              placeholder="Type Employee Name..."
              className={`w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none transition-all ${ringClass}`}
              disabled={disabled}
            />
            {loading && activeInput === "name" && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Autocomplete Floating Dropdown Menu */}
      {dropdownOpen && !disabled && (
        <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl border border-slate-200 shadow-2xl z-[150] max-h-80 overflow-y-auto divide-y divide-slate-100 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Select Employee from Organogram ({filteredEmployees.length} results)</span>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">Click to Auto-fill</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center p-8 text-slate-400 text-sm gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              Loading employee list...
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="p-6 text-center text-slate-500 text-sm">
              <User className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              No matching employee found for &quot;{query}&quot;
            </div>
          ) : (
            filteredEmployees.map((emp) => {
              const isSelected =
                employeeId.toLowerCase().trim() === emp.emp_code.toLowerCase().trim() ||
                employeeName.toLowerCase().trim() === emp.emp_name.toLowerCase().trim();

              return (
                <button
                  key={emp.emp_code}
                  type="button"
                  onClick={() => handleSelectOption(emp)}
                  className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-center justify-between group ${
                    isSelected ? "bg-blue-50/50" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`px-2.5 py-1 rounded-lg text-xs font-bold font-mono border ${badgeTheme}`}>
                      {emp.emp_code}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                        {emp.emp_name}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                        {emp.role && (
                          <span className="flex items-center gap-1">
                            <Briefcase className="w-3 h-3 text-slate-400" />
                            {emp.role}
                          </span>
                        )}
                        {emp.department && (
                          <span className="flex items-center gap-1">
                            <Building className="w-3 h-3 text-slate-400" />
                            {emp.department}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <Check className="w-5 h-5 text-blue-600 font-bold" />
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
