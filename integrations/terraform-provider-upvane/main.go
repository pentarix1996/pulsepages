package main

import (
	"context"
	"flag"
	"log"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"

	"github.com/upvane/terraform-provider-upvane/internal/provider"
)

// version is set at release time: go build -ldflags "-X main.version=1.2.3".
var version = "dev"

func main() {
	var debug bool
	flag.BoolVar(&debug, "debug", false, "run the provider with support for debuggers like delve")
	flag.Parse()

	err := providerserver.Serve(context.Background(), provider.New(version), providerserver.ServeOpts{
		Address: "registry.terraform.io/upvane/upvane",
		Debug:   debug,
	})
	if err != nil {
		log.Fatal(err.Error())
	}
}
