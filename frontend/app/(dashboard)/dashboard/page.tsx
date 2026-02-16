export default function DashboardPage() {
  return (
    <div className="p-10">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>

      <div className="grid grid-cols-3 gap-6">
        <div className="border p-6 rounded">
          <h2 className="font-semibold">Active Questionnaires</h2>
          <p className="text-3xl mt-2">0</p>
        </div>

        <div className="border p-6 rounded">
          <h2 className="font-semibold">Pending Approvals</h2>
          <p className="text-3xl mt-2">0</p>
        </div>

        <div className="border p-6 rounded">
          <h2 className="font-semibold">Generated JDs</h2>
          <p className="text-3xl mt-2">0</p>
        </div>
      </div>
    </div>
  );
}
