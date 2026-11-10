package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class NewsSummaryHtmlTest {

    @Test
    void htmlBodySummaryHasNoTagsAndTakesFirstThirtyVisibleChars() {
        // 联调实测的脏数据形态：HTML 正文直接截前 30 字会露出 <p>
        String content = "<p>美国食品药品监督管理局（FDA）近日宣布批准首款可穿戴人工智能系统正式投入临床应用。</p>";
        String visible = "美国食品药品监督管理局（FDA）近日宣布批准首款可穿戴人工智能系统正式投入临床应用。";
        String summary = NewsController.buildSummary(content);
        Assertions.assertFalse(summary.contains("<"));
        Assertions.assertFalse(summary.contains(">"));
        Assertions.assertEquals(visible.substring(0, 30), summary);
    }

    @Test
    void plainTextBodyKeepsTheExactLegacyBehaviour() {
        String content = "眼底影像人工智能分析系统Airdoc近日宣布其AI诊断功能实现重大更新，新版系统能够更精准地识别多种眼底疾病。";
        // 纯文本（无标签、无实体、无连续空白）逐字等价于旧实现的 substring(0,30)
        Assertions.assertEquals(content.substring(0, 30), NewsController.buildSummary(content));
    }

    @Test
    void visibleTextShorterThanThirtyIsRejectedWithBusinessCode() {
        // 原始字符数 >= 30，但剥掉标签后可见文字不足 30 —— 必须按可见文本判
        String shortVisibleHtml = "<p>短短几个字</p><div></div><span></span><em></em>";
        BusinessException ex = Assertions.assertThrows(BusinessException.class,
                () -> NewsController.buildSummary(shortVisibleHtml));
        Assertions.assertEquals(ErrorCode.PARAMS_ERROR.getCode(), ex.getCode());
        Assertions.assertTrue(ex.getMessage().contains("至少 30 字"));
        // 长标签串（原始长度远超 30）也不能靠原始长度蒙混过关
        String heavyTags = "<p>" + "<span></span>".repeat(20) + "短</p>";
        Assertions.assertThrows(BusinessException.class,
                () -> NewsController.buildSummary(heavyTags));
    }

    @Test
    void exactlyThirtyVisibleCharsPassAndEqualTheWholeVisibleText() {
        String visible = "一二三四五六七八九十".repeat(3); // 30 字
        String content = "<p>" + visible + "</p>更多正文";
        Assertions.assertEquals(visible, NewsController.buildSummary(content));
    }

    @Test
    void trailingIncompleteTagIsStripped() {
        // 正文以未闭合的半截标签收尾（<p / <di / </p），剥标签后不得残留进摘要
        String content = "<p>" + "眼底影像人工智能分析系统".repeat(3) + "</p><p";
        String summary = NewsController.buildSummary(content);
        Assertions.assertFalse(summary.contains("<"));
        Assertions.assertFalse(summary.contains(">"));

        String closingHalfTag = "<p>" + "眼底影像人工智能分析系统".repeat(3) + "</p></di";
        Assertions.assertFalse(NewsController.buildSummary(closingHalfTag).contains("<"));
    }

    @Test
    void literalLessThanInBodyIsNotSwallowed() {
        String content = "<p>正文里 1 < 3 且 a <3 心，这些都是字面量尖括号。</p>";
        String summary = NewsController.buildSummary(content);
        Assertions.assertFalse(summary.contains("<p"));
        Assertions.assertTrue(summary.contains("< 3") || summary.contains("<3"));
        // 正文以字面量 <3 收尾、且落在前 30 字窗口内时，不得被当成未闭合标签删掉
        String trailingLiteral = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八<3";
        Assertions.assertEquals(trailingLiteral, NewsController.buildSummary(trailingLiteral));
    }

    @Test
    void htmlEntitiesAreUnescapedBeforeMeasuring() {
        // &amp; 等实体反转义后按可见字符计，且不应把 &lt; 还原出的尖括号当标签吃掉
        String content = "<p>A &amp; B &lt; 3 与 &nbsp; 空格" + "可见文字补齐三十字".repeat(3) + "</p>";
        String summary = NewsController.buildSummary(content);
        Assertions.assertFalse(summary.contains("&amp;"));
        Assertions.assertFalse(summary.contains("<p"));
        Assertions.assertTrue(summary.startsWith("A & B"));
        // &nbsp; 反转义为 U+00A0 NBSP，必须被空白归一压成普通空格，而不是留在摘要里
        Assertions.assertFalse(summary.chars().anyMatch(c -> c == 0x00A0));
    }

    @Test
    void consecutiveWhitespaceBetweenTagsIsCollapsedAndSummaryNeverStartsWithSpace() {
        String content = "<p>\n   <span>眼底影像人工智能分析系统Airdoc近日宣布其AI诊断功能实现重大更新</span>\n</p>";
        String summary = NewsController.buildSummary(content);
        Assertions.assertFalse(summary.startsWith(" "));
        Assertions.assertFalse(summary.contains("\n"));
        Assertions.assertFalse(summary.contains("  "));
        Assertions.assertEquals(30, summary.length());
    }
}
