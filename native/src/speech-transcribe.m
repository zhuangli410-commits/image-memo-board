#import <Foundation/Foundation.h>
#import <Speech/Speech.h>

static void printError(NSString *message) {
  fprintf(stderr, "%s\n", message.UTF8String);
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) {
      printError(@"用法：speech-transcribe <录音路径>");
      return 1;
    }

    NSString *audioPath = [NSString stringWithUTF8String:argv[1]];
    if (![[NSFileManager defaultManager] fileExistsAtPath:audioPath]) {
      printError(@"录音文件不存在");
      return 1;
    }

    __block SFSpeechRecognizerAuthorizationStatus authorization =
      [SFSpeechRecognizer authorizationStatus];
    if (authorization == SFSpeechRecognizerAuthorizationStatusNotDetermined) {
      __block BOOL authorizationFinished = NO;
      [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
        authorization = status;
        authorizationFinished = YES;
      }];
      NSDate *authorizationDeadline = [NSDate dateWithTimeIntervalSinceNow:30];
      while (!authorizationFinished && authorizationDeadline.timeIntervalSinceNow > 0) {
        [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
      }
    }

    if (authorization != SFSpeechRecognizerAuthorizationStatusAuthorized) {
      printError(@"未获得语音识别权限");
      return 2;
    }

    NSLocale *locale = [[NSLocale alloc] initWithLocaleIdentifier:@"zh-CN"];
    SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc] initWithLocale:locale];
    if (!recognizer) {
      printError(@"当前系统不支持中文语音识别");
      return 3;
    }

    NSURL *audioURL = [NSURL fileURLWithPath:audioPath];
    SFSpeechURLRecognitionRequest *request =
      [[SFSpeechURLRecognitionRequest alloc] initWithURL:audioURL];
    request.shouldReportPartialResults = NO;
    if (recognizer.supportsOnDeviceRecognition) request.requiresOnDeviceRecognition = YES;

    __block NSString *transcript = nil;
    __block NSError *recognitionError = nil;
    __block BOOL finished = NO;
    SFSpeechRecognitionTask *task =
      [recognizer recognitionTaskWithRequest:request
                               resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
        if (result) {
          transcript = result.bestTranscription.formattedString;
          if (result.isFinal) finished = YES;
        }
        if (error) {
          recognitionError = error;
          finished = YES;
        }
      }];

    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:120];
    while (!finished && deadline.timeIntervalSinceNow > 0) {
      [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
    }
    [task cancel];

    if (transcript.length) {
      printf("%s\n", transcript.UTF8String);
      return 0;
    }
    if (recognitionError) {
      printError([NSString stringWithFormat:@"语音转写失败：%@",
                                            recognitionError.localizedDescription]);
    } else {
      printError(@"语音转写超时或没有识别到内容");
    }
    return 4;
  }
}
