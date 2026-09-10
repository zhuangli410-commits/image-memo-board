#import <Foundation/Foundation.h>
#import <Vision/Vision.h>

static int fail(NSString *message) {
  fprintf(stderr, "%s\n", message.UTF8String);
  return 1;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return fail(@"用法：image-ocr <图片路径>");

    NSString *imagePath = [NSString stringWithUTF8String:argv[1]];
    NSURL *imageURL = [NSURL fileURLWithPath:imagePath];
    if (![[NSFileManager defaultManager] fileExistsAtPath:imagePath]) {
      return fail(@"无法读取图片");
    }

    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.usesLanguageCorrection = YES;
    NSError *languageError = nil;
    NSArray<NSString *> *supportedLanguages =
      [VNRecognizeTextRequest
        supportedRecognitionLanguagesForTextRecognitionLevel:VNRequestTextRecognitionLevelAccurate
        revision:request.revision
        error:&languageError];
    NSMutableArray<NSString *> *preferredLanguages = [NSMutableArray array];
    for (NSString *language in @[@"zh-Hans", @"zh-Hant", @"en-US"]) {
      if ([supportedLanguages containsObject:language]) [preferredLanguages addObject:language];
    }
    if (preferredLanguages.count) request.recognitionLanguages = preferredLanguages;
    if (getenv("OCR_DEBUG")) {
      fprintf(stderr, "revision=%lu languages=%s error=%s\n",
              (unsigned long)request.revision,
              supportedLanguages.description.UTF8String,
              languageError.localizedDescription.UTF8String ?: "");
    }

    VNImageRequestHandler *handler =
      [[VNImageRequestHandler alloc] initWithURL:imageURL options:@{}];
    NSError *error = nil;
    if (![handler performRequests:@[request] error:&error]) {
      return fail(error
        ? [NSString stringWithFormat:@"OCR 失败：%@", error.localizedDescription]
        : @"OCR 失败：Vision 未返回详细原因");
    }

    NSMutableArray<NSString *> *lines = [NSMutableArray array];
    for (VNRecognizedTextObservation *observation in request.results) {
      VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
      if (candidate.string.length) [lines addObject:candidate.string];
    }
    printf("%s\n", [[lines componentsJoinedByString:@"\n"] UTF8String]);
    return 0;
  }
}
