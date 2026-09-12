// 把若干文件/目录以「真文件」形式写进 macOS 通用剪贴板。
//
// 两个写入通道都要铺：
//   public.file-url      —— 每个文件一个 NSPasteboardItem，Finder 和现代 app 读这个
//   NSFilenamesPboardType —— 老派 app（微信、部分上传框）读这个
// 只铺前者，一些 app 会只粘到第一个文件；只铺后者，Finder 侧行为不稳。
//
// 注意：writeObjects 传 NSURL 数组的写法在 osascript 脚本文件里会静默只落一个 item
// （同样的代码用 -e 内联却是对的，JXA 的坑）。所以这里显式构造 NSPasteboardItem，
// 并且**写完回读校验条目数**——交付工具静默丢文件比直接报错糟得多。
ObjC.import('AppKit');

function run(argv) {
  if (!argv || argv.length === 0) throw new Error('no paths given');

  const paths = argv.map(function (p) {
    return ObjC.unwrap($(p).stringByStandardizingPath);
  });

  const pb = $.NSPasteboard.generalPasteboard;
  pb.clearContents;

  const items = $.NSMutableArray.alloc.init;
  paths.forEach(function (p) {
    const item = $.NSPasteboardItem.alloc.init;
    item.setStringForType(
      $.NSURL.fileURLWithPath($(p)).absoluteString,
      $('public.file-url')
    );
    items.addObject(item);
  });

  if (!pb.writeObjects(items)) throw new Error('pasteboard write rejected');

  // 老派 app 的通道，尽力而为：失败不致命，前一条通道已经覆盖大部分场景
  try {
    pb.setPropertyListForType($(paths), $('NSFilenamesPboardType'));
  } catch (e) {}

  // 回读校验：条目数必须对得上，否则宁可报错
  const landed = ObjC.unwrap(pb.pasteboardItems).length;
  if (landed !== paths.length) {
    throw new Error('剪贴板只收下 ' + landed + ' / ' + paths.length + ' 项');
  }
  return String(landed);
}
