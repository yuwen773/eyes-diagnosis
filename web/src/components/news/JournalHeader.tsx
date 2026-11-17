import type { FormEvent } from "react"
import { Link } from "react-router-dom"

import type { NewsItem } from "@/lib/api"
import { newsDate } from "@/lib/news"
import { GlareImage } from "./GlareImage"

/**
 * 期刊抬头（Journal Header）。
 *
 * <p>旧版这里是一整屏 hero：眉线、巨号刊名、副标题、检索框各占一行，
 * 真正资讯要往下滚两屏才看得到。现在压成一条期刊抬头：刊名与检索
 * 同行，最新一条的真实标题直接落在抬头里——读者第一眼看到的是内容，
 * 不是装饰。
 *
 * <p>抬头里的每一样都是接口给的真东西：最新一条来自当前结果集的真实
 * 第一条（有封面才有封面位，没封面就是纯文字排版，不拿假图补位），
 * 日期与作者有才写。
 */
export function JournalHeader({
  latest,
  keyword,
  onKeywordChange,
  onSearch,
  onClear,
  searching,
}: {
  /** 当前结果集里的最新一条（第一页且未检索时才有）。 */
  latest?: NewsItem | null
  keyword: string
  onKeywordChange: (value: string) => void
  onSearch: (event: FormEvent) => void
  onClear: () => void
  searching: boolean
}) {
  // 缺发布时间就不写时间——newsDate 会给一个「—」占位，但抬头是读者
  // 先看到的那一行，一个破折号比没有更让人以为这里出了错。
  const meta = latest?.publishTime ? newsDate(latest.publishTime) : null
  const metaParts = [meta?.date, meta?.time, latest?.author].filter(Boolean).join(" · ")

  return (
    <header className="journal">
      <div className="journal__top">
        <div className="journal__id">
          <p className="journal__eyebrow num">IRIS JOURNAL</p>
          <h1 className="journal__title">眼科前沿</h1>
          <p className="journal__sub">
            眼健康科普、学科动态与院内公告 · 按发布时间排列，打开即为全文
          </p>
        </div>

        <form className="news__search journal__search" onSubmit={onSearch} role="search">
          <label className="news__search-label overline" htmlFor="news-search">
            检索标题 · SEARCH
          </label>
          <div className="news__search-row">
            <input
              id="news-search"
              className="news__input"
              type="search"
              value={keyword}
              placeholder="按标题检索…"
              onChange={(event) => onKeywordChange(event.target.value)}
            />
            <button className="news__submit" type="submit">
              检索
            </button>
            {searching ? (
              <button className="news__clear" type="button" onClick={onClear}>
                清除
              </button>
            ) : null}
          </div>
        </form>
      </div>

      {latest ? (
        // 整块头条就是一个链接：标题、日期、封面都能进文章。
        //
        // 原先只有标题是链接，封面是块死的图——读者会去点图，点了没反应。
        // 现在整块可点，键盘上也只有**一个** Tab 停靠点（标题不再单独成一个
        // 链接），读屏不会把同一篇文章念两遍。
        //
        // 有真实封面才摆图位：头条是有图有文的双栏，纯文字的那一档就占满
        // 整行。绝不拿占位图补位——假图比没有图更糟。
        <Link
          to={`/news/${latest.id}`}
          className={`journal__latest${latest.coverImage ? "" : " is-text"}`}
          data-cursor
          data-cursor-label="阅读头条"
        >
          <div className="journal__latest-text">
            <p className="journal__latest-eyebrow overline num">
              最新 · LATEST
              {metaParts ? <span className="journal__latest-meta num">{metaParts}</span> : null}
            </p>
            <h2 className="journal__latest-title">{latest.title || "未命名文章"}</h2>
          </div>

          {latest.coverImage ? (
            <GlareImage
              className="journal__latest-plate"
              imgClassName="journal__latest-img"
              src={latest.coverImage}
              alt=""
            />
          ) : null}
        </Link>
      ) : null}
    </header>
  )
}
