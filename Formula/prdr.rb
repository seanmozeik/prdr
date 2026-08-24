class Prdr < Formula
  desc "Read and update GitHub pull request review conversations safely"
  homepage "https://github.com/seanmozeik/prdr"
  version "0.1.0"
  license "MIT"

  url "https://github.com/seanmozeik/prdr/releases/download/v#{version}/prdr-#{version}.tar.gz"
  sha256 "c9e0aedf3c745f5ef45d132dd01707bce484f883473ddca7e2c953e945e5fb8b"

  depends_on "oven-sh/bun/bun"
  depends_on "gh"

  on_linux do
    depends_on "libsecret"
  end

  def install
    libexec.install Dir["*"]
    (bin/"prdr").write <<~EOS
      #!/bin/bash
      exec "#{Formula["bun"].opt_bin}/bun" "#{libexec}/dist/prdr.js" "$@"
    EOS
  end

  test do
    assert_match "prdr", shell_output("#{bin}/prdr --help")
  end
end
