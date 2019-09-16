window.addEventListener("load", () => {
    let pageid = utils.search.pageid || Object.values(utils.search)[0] || "unknow";
    let count = utils.createNode('span', "hide", `<i class="leancloud-visitors" data-flag-title="${document.title}" id="${pageid}"><i class="leancloud-visitors-count"/></i>`);
    document.body.appendChild(count);
    let observer = new MutationObserver(() => {
        let textContent = utils.$(".leancloud-visitors-count", count)[0].textContent;
        textContent && window.ongetvisitcount && ongetvisitcount(textContent)
    });
    observer.observe(utils.$(".leancloud-visitors-count", count)[0], {
        subtree: true,
        childList: true,
        characterData: true,
        characterDataOldValue: true
    });
    utils.addJs("/3rd-lib/Valine.min.1.3.js", true, () => {
        new Valine({
            path: pageid,
            el: '#vcomments',
            appId: '751qUy7vopNoxdoECmRgMGbo-MdYXbMMI',
            appKey: 'SlzOdYaXhKYhqPl20XIr2ost',
            placeholder: "评论一下。\n欢迎在上方留下您的昵称、邮箱、主页。",
            verify: true,
            visitor: true,
            region: "us"
        })
    });
});

