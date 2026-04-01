import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const faqs = [
  {
    question: "How often are baskets published?",
    answer: "The operating cadence is weekly, with the current basket refreshed and tracked throughout the week.",
  },
  {
    question: "How is performance shown?",
    answer: "Each position shows whether the mark is actual, estimated, or expiry-resolved. Manual close values override modeled marks when available.",
  },
  {
    question: "Is historical archive access included?",
    answer: "Yes. Members can search and review prior baskets, supporting notes, and stored snapshots over time.",
  },
];

export default function FAQPage() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-16 sm:px-6 lg:px-8">
      <div>
        <p className="eyebrow text-xs text-muted-foreground">FAQ</p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight">Practical questions</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Common questions</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible>
            {faqs.map((faq) => (
              <AccordionItem key={faq.question} value={faq.question}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent>{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
