export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-16 sm:px-6 lg:px-8">
      <p className="eyebrow text-xs text-muted-foreground">About</p>
      <h1 className="text-5xl font-semibold tracking-tight">Polytheta exists to make options research more operable.</h1>
      <p className="text-lg leading-8 text-muted-foreground">
        The product is designed around a simple belief: recommendations are more useful
        when they arrive with structure, context, and honest tracking. Instead of turning
        weekly ideas into feed noise, Polytheta packages them as a durable operating
        record that members can review, monitor, and learn from over time.
      </p>
    </div>
  );
}
