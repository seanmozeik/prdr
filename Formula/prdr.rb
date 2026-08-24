class Prdr < Formula
  desc "Read and update GitHub pull request review conversations safely"
  homepage "https://github.com/seanmozeik/prdr"
  version "0.1.0"
  license "MIT"

  url "https://github.com/seanmozeik/prdr/releases/download/v#{version}/prdr-#{version}.tar.gz"
  sha256 "e8fb6f961baa9942f72dd9322f55f4338493c758d0c7e7032814ef0c2416f14a"

  depends_on "oven-sh/bun/bun"

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
