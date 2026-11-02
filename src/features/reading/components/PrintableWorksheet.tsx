// 阅读文章完整打印工作表
//
// 一键打印一篇阅读理解的完整纸质练习材料，包含六个部分：
// ① 文章原文 ② 阅读理解题 ③ 语法填空题 ④ 参考答案（含解析与定位线索）
// ⑤ 重点单词（含音标/词性/释义/例句）⑥ 重点短语（含释义/例句/例句翻译）
// 以及全文中文翻译（段落对照）。
//
// 渲染方式：由 ReadingPage 通过 createPortal 挂载到 document.body 的
// .print-portal 容器（index.css 中默认 display:none，仅 @media print 显示，
// 同时隐藏 #root 应用主体），挂载后自动唤起浏览器打印对话框，
// afterprint 事件触发后通知父组件卸载，不影响正常浏览视图。
import { useEffect } from 'react'
import type { Article, Question } from '@/shared/types'
import { useTranslation } from '@/shared/i18n/useTranslation'
import { TOPIC_LABEL, DIFFICULTY_LABEL } from '../types'

interface PrintableWorksheetProps {
  article: Article
  // 阅读理解题（可能尚未生成，为空时跳过对应章节）
  questions: Question[]
  // 语法填空题（可能尚未生成，为空时跳过对应章节）
  grammarQuestions: Question[]
  // 打印结束（用户关闭打印对话框）后的回调，父组件据此卸载本组件
  onFinished: () => void
}

// 选项字母（与 correctIndex 下标对应）
const LETTERS = ['A', 'B', 'C', 'D'] as const

// 按空行/换行拆分段落（与阅读页展示逻辑一致的轻量实现）
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// 章节标题（统一编号与样式，编号与标题由字典整体提供）
function SectionTitle({ title }: { title: string }) {
  return (
    <h2 className="mb-2 mt-5 break-inside-avoid border-b border-gray-400 pb-1 text-base font-bold text-black">
      {title}
    </h2>
  )
}

// 答题括号（全角空格用 \u3000 转义，规避 no-irregular-whitespace 规则）
const ANSWER_BLANK = '(\u3000\u3000)'

// 单题渲染：题干 + 选项（A-D）+ 答题括号
function QuestionBlock({ question, index }: { question: Question; index: number }) {
  return (
    <div className="mb-3 break-inside-avoid">
      <p className="text-sm font-medium text-black">
        {index + 1}. {question.stem} <span className="tracking-widest">{ANSWER_BLANK}</span>
      </p>
      <ol className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 pl-5 text-sm text-black">
        {question.options.map((opt, i) => (
          <li key={i}>
            {LETTERS[i]}. {opt}
          </li>
        ))}
      </ol>
    </div>
  )
}

// 答案与解析单条渲染
function AnswerBlock({ question, index }: { question: Question; index: number }) {
  const { t } = useTranslation()
  return (
    <li className="mb-1.5 break-inside-avoid text-sm text-black">
      <span className="font-bold">
        {index + 1}. {LETTERS[question.correctIndex] ?? '-'}
      </span>
      {question.explanation && <span className="text-gray-800">{'\u3000'}{question.explanation}</span>}
      {question.locationClue && (
        <span className="block text-xs text-gray-600">
          {t('reading.print.locate', { clue: question.locationClue })}
        </span>
      )}
    </li>
  )
}

export default function PrintableWorksheet({
  article,
  questions,
  grammarQuestions,
  onFinished,
}: PrintableWorksheetProps) {
  const { t, language } = useTranslation()
  // 挂载后等待 DOM 渲染完成再唤起打印；打印对话框关闭（afterprint）或超时兜底后通知卸载
  useEffect(() => {
    const timer = window.setTimeout(() => window.print(), 100)
    // 超时兜底：个别浏览器 afterprint 不触发时避免组件常驻隐藏 DOM
    const fallback = window.setTimeout(onFinished, 60_000)
    window.addEventListener('afterprint', onFinished)
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(fallback)
      window.removeEventListener('afterprint', onFinished)
    }
  }, [onFinished])

  const englishParagraphs = splitParagraphs(article.content)
  const translationParagraphs = splitParagraphs(article.translation ?? '')
  // 词汇来源：优先增强版 vocabulary（含重要度/例句翻译），退回 highlightedWords
  const vocabRows =
    article.vocabulary ??
    (article.highlightedWords ?? []).map((w) => ({
      word: w.word,
      phonetic: w.phonetic,
      pos: w.pos,
      definition: w.definition,
      example: w.example,
      importance: 'medium' as const,
    }))
  const phrases = article.phrases ?? []
  // 元信息分隔符（全角空格 \u3000 转义，规避 no-irregular-whitespace 规则）
  const SEP = '\u3000'

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-black">
      {/* 标题与元信息 */}
      <header className="mb-4 break-inside-avoid border-b-2 border-black pb-3">
        <h1 className="text-xl font-bold text-black">{article.title}</h1>
        <p className="mt-1.5 text-xs text-gray-700">
          {article.topic
            ? `${TOPIC_LABEL[article.topic] ? t(`reading.topic.${article.topic}`) : article.topic}${SEP}`
            : ''}
          {article.difficulty
            ? `${t('reading.print.meta_difficulty', {
                label: DIFFICULTY_LABEL[article.difficulty]
                  ? t(`reading.difficulty.${article.difficulty}`)
                  : article.difficulty,
              })}${SEP}`
            : ''}
          {article.wordCount ? `${t('reading.words_count', { count: article.wordCount })}${SEP}` : ''}
          {article.lexileRange
            ? `${t('reading.lexile', {
                range: `${article.lexileRange.min}-${article.lexileRange.max}L`,
              })}${SEP}`
            : ''}
          {t('reading.print.meta_created', {
            date: new Date(article.createdAt).toLocaleDateString(language),
          })}
        </p>
      </header>

      {/* 一、阅读原文（完整英文正文，做题前先读） */}
      {englishParagraphs.length > 0 && (
        <section className="mt-4">
          <SectionTitle title={t('reading.print.section_1')} />
          {englishParagraphs.map((para, i) => (
            <p key={i} className="mb-2 break-inside-avoid text-sm leading-relaxed text-black">
              {para}
            </p>
          ))}
        </section>
      )}

      {/* 二、阅读理解 */}
      {questions.length > 0 && (
        <section className="mt-4">
          <SectionTitle title={t('reading.print.section_2', { count: questions.length })} />
          {questions.map((q, i) => (
            <QuestionBlock key={q.id} question={q} index={i} />
          ))}
        </section>
      )}

      {/* 三、语法填空 */}
      {grammarQuestions.length > 0 && (
        <section className="mt-4">
          <SectionTitle title={t('reading.print.section_3', { count: grammarQuestions.length })} />
          {grammarQuestions.map((q, i) => (
            <QuestionBlock key={q.id} question={q} index={i} />
          ))}
        </section>
      )}

      {/* 四、参考答案 */}
      {(questions.length > 0 || grammarQuestions.length > 0) && (
        <section className="mt-4">
          <SectionTitle title={t('reading.print.section_4')} />
          {questions.length > 0 && (
            <div className="mb-3">
              <h3 className="mb-1.5 text-sm font-bold text-black">{t('reading.quiz.reading_section')}</h3>
              <ol className="list-none pl-1">
                {questions.map((q, i) => (
                  <AnswerBlock key={q.id} question={q} index={i} />
                ))}
              </ol>
            </div>
          )}
          {grammarQuestions.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-sm font-bold text-black">{t('reading.grammar.section')}</h3>
              <ol className="list-none pl-1">
                {grammarQuestions.map((q, i) => (
                  <AnswerBlock key={q.id} question={q} index={i} />
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      {/* 五、重点单词 */}
      {vocabRows.length > 0 && (
        <section className="mt-4">
          <SectionTitle title={t('reading.print.section_5', { count: vocabRows.length })} />
          <table className="w-full border-collapse text-sm text-black">
            <thead>
              <tr className="border-b border-gray-400 text-left">
                <th className="w-24 py-1 pr-2">{t('reading.print.col_word')}</th>
                <th className="w-28 py-1 pr-2">{t('reading.print.col_phonetic')}</th>
                <th className="w-12 py-1 pr-2">{t('reading.print.col_pos')}</th>
                <th className="w-36 py-1 pr-2">{t('reading.print.col_definition')}</th>
                <th className="py-1">{t('reading.print.col_example')}</th>
              </tr>
            </thead>
            <tbody>
              {vocabRows.map((w) => (
                <tr key={w.word} className="break-inside-avoid border-b border-gray-200 align-top">
                  <td className="py-1 pr-2 font-medium">
                    {w.word}
                    {w.importance === 'high' && <span className="ml-1 text-xs">{t('reading.print.core_badge')}</span>}
                  </td>
                  <td className="py-1 pr-2 text-gray-700">{w.phonetic}</td>
                  <td className="py-1 pr-2 text-gray-700">{w.pos}</td>
                  <td className="py-1 pr-2">{w.definition}</td>
                  <td className="py-1 text-gray-800">{w.example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* 六、重点短语 */}
      {phrases.length > 0 && (
        <section className="mt-4">
          <SectionTitle title={t('reading.print.section_6', { count: phrases.length })} />
          <table className="w-full border-collapse text-sm text-black">
            <thead>
              <tr className="border-b border-gray-400 text-left">
                <th className="w-36 py-1 pr-2">{t('reading.print.col_phrase')}</th>
                <th className="w-36 py-1 pr-2">{t('reading.print.col_definition')}</th>
                <th className="py-1">{t('reading.print.col_example')}</th>
              </tr>
            </thead>
            <tbody>
              {phrases.map((p) => (
                <tr key={p.phrase} className="break-inside-avoid border-b border-gray-200 align-top">
                  <td className="py-1 pr-2 font-medium">{p.phrase}</td>
                  <td className="py-1 pr-2">{p.meaning}</td>
                  <td className="py-1 text-gray-800">
                    {p.example}
                    {p.exampleTranslation && (
                      <span className="block text-xs text-gray-600">{p.exampleTranslation}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* 七、全文翻译（段落对照） */}
      {translationParagraphs.length > 0 && (
        <section className="mt-4">
          <SectionTitle title={t('reading.print.section_7')} />
          {englishParagraphs.map((para, i) => (
            <div key={i} className="mb-2.5 break-inside-avoid">
              <p className="text-sm text-black">{para}</p>
              {translationParagraphs[i] && (
                <p className="mt-0.5 text-sm text-gray-700">{translationParagraphs[i]}</p>
              )}
            </div>
          ))}
          {/* 翻译段落数多于原文时（极少见的对齐偏差），追加剩余段落避免漏译 */}
          {translationParagraphs.length > englishParagraphs.length && (
            <div className="break-inside-avoid">
              {translationParagraphs.slice(englishParagraphs.length).map((para, i) => (
                <p key={`extra-${i}`} className="mb-1 text-sm text-gray-700">
                  {para}
                </p>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
