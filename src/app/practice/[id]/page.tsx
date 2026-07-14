import PracticeRoute from '../../../components/practice/PracticeRoute';

export default async function PracticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PracticeRoute questionId={id} />;
}
