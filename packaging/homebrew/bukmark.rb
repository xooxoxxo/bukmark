# Formula for the xooxoxxo/homebrew-tap tap: brew install xooxoxxo/tap/bukmark
# Copy it to Formula/bukmark.rb in that repo. To move it to a new release, run
# packaging/homebrew/update-formula.sh <version> from the bukmark repo.
class Bukmark < Formula
  desc "Self-hosted bookmark manager that runs in Docker"
  homepage "https://bukmark.it"
  url "https://github.com/xooxoxxo/bukmark/archive/refs/tags/v0.3.0.tar.gz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"

  livecheck do
    url :stable
    regex(/^v?(\d+(?:\.\d+)+)$/i)
  end

  def install
    bin.install "packaging/bin/bukmark"
  end

  def caveats
    runtime = if OS.mac?
      <<~EOS
        bukmark runs in Docker and needs Docker with Compose v2. Homebrew does
        not install it for you. Any one of these works:
          OrbStack:        brew install --cask orbstack
          Docker Desktop:  brew install --cask docker-desktop
          Colima:          brew install colima docker docker-compose
                           (see brew info docker-compose), then: colima start
      EOS
    else
      <<~EOS
        bukmark runs in Docker and needs Docker Engine with the Compose v2
        plugin. Homebrew does not install it for you; install it from your
        distribution or https://docs.docker.com/engine/install/.
      EOS
    end

    <<~EOS
      #{runtime}
      Then set it up:
        bukmark setup

      Data lives in ~/.bukmark. bukmark help lists the other commands.
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/bukmark version")
    assert_match "setup", shell_output("#{bin}/bukmark help")
  end
end
