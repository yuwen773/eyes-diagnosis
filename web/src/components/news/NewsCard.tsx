import { Link } from "react-router-dom"

import type { NewsItem } from "@/lib/api"
import { newsDate, newsExcerpt, newsOpening } from "@/lib/news"
import { GlareImage } from "./GlareImage"

/**
 * 资讯卡（编辑网格里的一张）。
 *
 * <p>只摆接口给的东西：发布时间、标题、摘要、真实封面。没有分类、没有
 * 阅读数、没有「编辑精选」——那些字段后端没有，编出来就是假信息。
 *
 * <p>有封面才用封面；没封面的卡走纯文字排版，不拿占位图补位。
 */
export function NewsCard({
  item,
  index,
}: {
  item: NewsItem
  /** 网格里的次序，用来错开入场动画。 */
  index: number
}) {
  // 缺发布时间就不摆日期位：newsDate 会给一个「—」占位，卡片上留一个
  // 破折号看起来像坏了，不如这一格空着。
  const { date } = item.publishTime ? newsDate(item.publishTime) : { date: "" }
  // 摘要取正文开头，不是后端的 summary——那条常常是标题的回声，摆在标题
  // 下面等于把同一句话读两遍。正文空了就退回摘要，再空就不摆这一行。
  const excerpt = newsOpening(item.content, 72) || newsExcerpt(item.content, item.summary, 72)

  return (
    <li
      className={`journal-card reveal${item.coverImage ? "" : " journal-card--text"}`}
      style={{ "--d": `${Math.min(index, 8) * 60}ms` } as React.CSSProperties}
    >
      <Link className="journal-card__link" to={`/news/${item.id}`} data-cursor data-cursor-label="阅读全文">
        {item.coverImage ? (
          <GlareImage
            className="journal-card__plate"
            imgClassName="journal-card__img"
            src={item.coverImage}
            alt=""
          />
        ) : null}

        <div className="journal-card__body">
          {date ? <p className="journal-card__date num">{date}</p> : null}
          <h3 className="journal-card__title">{item.title || "未命名文章"}</h3>
          {excerpt ? <p className="journal-card__excerpt">{excerpt}</p> : null}
        </div>
      </Link>
    </li>
  )
}
