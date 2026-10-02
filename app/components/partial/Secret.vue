<template>
<!-- 外层元素用于占位 -->
<div class="secret-container">
	<div class="secret">
		<slot />
	</div>
</div>
</template>

<style scoped>
.secret {
	position: relative;
	opacity: 0;
	transition: all 0.2s var(--secret-delay, 0.5s), color 0.2s;
	z-index: -1;
}

/*
 * 原来的写法是嵌在 `.secret` 里的 `&:hover > &, &:focus-within > &`。
 * `&` 在任何位置都代表父规则的选择器，拍平后得到
 * `.secret[data-v-x]:hover > .secret[data-v-x]` —— 要求元素是自己的后代。
 * 而模板里 `.secret` 是唯一的、没有嵌套同名子元素，该规则**永远不匹配**，
 * 结果是 secret 从不显形（「查看预览文章」链接在线上不可见）。
 *
 * 结合模板注释「外层元素用于占位」与 `z-index: -1` 的遮罩意图，
 * 作者想表达的是「悬停/聚焦外层容器时显形」，故改为挂到 `.secret-container` 上。
 */
.secret-container:hover > .secret,
.secret-container:focus-within > .secret {
	opacity: 1;
	z-index: 0;
}
</style>
