export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">JD Intelligence Agent</h1>
      <p className="mt-2">Create and manage your Job Description</p>

      <a
        href="/questionnaire"
        className="inline-block mt-4 px-4 py-2 bg-black text-white rounded"
      >
        Start JD Interview
      </a>
    </div>
  );
}
