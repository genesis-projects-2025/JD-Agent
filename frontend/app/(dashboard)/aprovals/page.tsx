export default function ApprovalsPage() {
  return (
    <div>
      <h2 className="text-xl font-semibold">JD Approvals</h2>
      <p className="mt-2">Review, edit, and approve Job Descriptions.</p>

      <div className="mt-4 p-4 border rounded">
        <h3 className="font-medium">Software Engineer JD</h3>
        <button className="mt-2 px-3 py-1 bg-green-600 text-white rounded">
          Approve
        </button>
      </div>
    </div>
  );
}
